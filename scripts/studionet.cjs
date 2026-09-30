#!/usr/bin/env node
/**
 * Shared plumbing for the Studionet drivers.
 *
 * Every hard-won detail about talking to Studionet lives here rather than being
 * repeated in each script:
 *
 *  1. Only browser-like User-Agents get through Cloudflare. The Node.js SDK
 *     qualifies, the Python SDK does not, so gltest cannot be used here at all.
 *  2. A transaction can reach ACCEPTED and FINALIZED and still have rolled
 *     back. Only consensus_data.leader_receipt says which happened, and
 *     result.payload is the only place the reason appears.
 *  2b. A receipt is only believed once its hash matches the hash that was just
 *     submitted, otherwise an earlier transaction's outcome gets attributed to
 *     the call under test.
 *  3. 30 JSON-RPC requests per minute, 500 per hour, rejected with -32029 and a
 *     retry_after_seconds hint. Every call is paced and backs off on the hint.
 *  4. A child contract deployed with on="finalized" is not readable until the
 *     parent finalizes, so reads retry on "not found" and "execution failed".
 *  5. genlayer-js is resolved from the global `genlayer` CLI install, so nothing
 *     needs npm installing.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GLOBAL_MODULES = path.join(execSync("npm root -g").toString().trim(), "genlayer", "node_modules");
const { createClient, createAccount, chains } = require(path.join(GLOBAL_MODULES, "genlayer-js"));

const RPC_SPACING_MS = 2100;
const READ_ATTEMPTS = 24;
const READ_BACKOFF_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (wei) => `${(Number(BigInt(wei)) / 1e18).toFixed(6)} GEN`;

function makeClient(keyPath) {
  const key = fs.readFileSync(keyPath, "utf-8").trim();
  return createClient({ chain: chains.studionet, account: createAccount(key) });
}

function makeDriver(client) {
  let lastCall = 0;

  async function paced(fn) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const wait = lastCall + RPC_SPACING_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try {
        return await fn();
      } catch (err) {
        const retryAfter = err?.data?.retry_after_seconds ?? err?.cause?.data?.retry_after_seconds;
        const message = err?.message ?? "";
        if (retryAfter === undefined && !/rate limit/i.test(message)) throw err;
        await sleep((Number(retryAfter ?? 10) + 2) * 1000);
      }
    }
    throw new Error("gave up after repeated rate limits");
  }

  /**
   * Reject a receipt that belongs to a different transaction.
   *
   * A receipt can carry its own hashes under several names depending on the
   * node version, and a receipt that belongs to an earlier transaction looks
   * exactly like a successful one. Reading it would attribute some previous
   * intent's outcome to the call that was just submitted, so the hash is
   * compared before the receipt is believed at all.
   */
  function receiptHashMismatch(receipt, expected) {
    if (!expected) return null;
    const got =
      receipt?.transaction_hash ??
      receipt?.transactionHash ??
      receipt?.hash ??
      receipt?.to_transaction_hash;
    if (got === undefined || got === null) return null; // node did not echo it
    return String(got).toLowerCase() === String(expected).toLowerCase() ? null : `${got} != ${expected}`;
  }

  /** null when the leader actually returned, otherwise a diagnostic string. */
  function executionFailure(receipt) {
    const leader = receipt?.consensus_data?.leader_receipt?.[0];
    if (!leader) return "no leader receipt in the response";
    const status = leader.result?.status;
    if (leader.execution_result === "SUCCESS" && (status === undefined || status === "return")) return null;
    const parts = [];
    if (leader.execution_result !== "SUCCESS") parts.push(`execution_result=${leader.execution_result}`);
    if (leader.error_code) parts.push(`error_code=${leader.error_code}`);
    if (status) parts.push(`result=${status}`);
    const payload = leader.result?.payload;
    if (payload !== undefined && payload !== null) {
      parts.push(`payload=${(typeof payload === "string" ? payload : JSON.stringify(payload)).slice(0, 300)}`);
    }
    return parts.length ? parts.join(" | ") : "unknown failure";
  }

  async function readFrom(address, method, args = []) {
    let lastError;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
      try {
        return await paced(() => client.readContract({ address, functionName: method, args }));
      } catch (err) {
        lastError = err;
        if (!/execution failed|invalid parameters|not found/i.test(err?.message ?? "")) throw err;
        await sleep(READ_BACKOFF_MS);
      }
    }
    throw lastError;
  }

  const waitReceipt = (hash) =>
    paced(() => client.waitForTransactionReceipt({ hash, status: "ACCEPTED", interval: 4000, retries: 120 }));

  async function writeTo(address, method, args = [], value = 0n) {
    let hash;
    try {
      hash = await paced(() =>
        client.writeContract({ address, functionName: method, args, value, consensusMaxRotations: 5 }),
      );
    } catch (err) {
      return { ok: false, phase: "submit", reason: err.message };
    }
    let receipt;
    try {
      receipt = await waitReceipt(hash);
    } catch (err) {
      return { ok: false, phase: "receipt", reason: err.message, hash };
    }
    const stale = receiptHashMismatch(receipt, hash);
    if (stale) return { ok: false, phase: "receipt", reason: `receipt is for another transaction: ${stale}`, hash };
    const failure = executionFailure(receipt);
    if (failure) return { ok: false, phase: "execute", reason: failure, hash };
    return { ok: true, hash, receipt };
  }

  async function deployContract(code, args = []) {
    let hash;
    try {
      hash = await paced(() => client.deployContract({ code, args, consensusMaxRotations: 5 }));
    } catch (err) {
      return { ok: false, phase: "submit", reason: err.message };
    }
    const receipt = await waitReceipt(hash);
    const stale = receiptHashMismatch(receipt, hash);
    if (stale) return { ok: false, phase: "receipt", reason: `receipt is for another transaction: ${stale}`, hash };
    const failure = executionFailure(receipt);
    if (failure) return { ok: false, phase: "execute", reason: failure, hash };
    return { ok: true, hash, address: receipt.contract_address || receipt.to_address };
  }

  const balance = () => paced(() => client.getBalance({ address: client.account.address }));

  return { paced, readFrom, writeTo, deployContract, waitReceipt, executionFailure, receiptHashMismatch, balance };
}

module.exports = { makeClient, makeDriver, sleep, fmt };
