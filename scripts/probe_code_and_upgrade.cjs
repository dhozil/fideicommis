#!/usr/bin/env node
/**
 * Does GenLayer expose deployed source code, and does it expose an upgrade path?
 *
 * The documentation research turned up two things worth measuring rather than repeating:
 *
 *   1. `gen_getContractCode` returns the source of a deployed contract. That would make
 *      attestation possible: fetch the code at an address, run it through the schema, and
 *      compare against the local source. The reader currently has nothing stronger than two
 *      view methods agreeing with each other, which is a consistency check and not an
 *      attestation. No `codeHash` method exists anywhere in the docs — the code itself is
 *      the only identity available.
 *
 *   2. Intelligent contracts are documented as **upgradeable**, not frozen: `gl.storage.Root`
 *      holds a code slot and an `upgraders` list, and an address on that list can replace the
 *      code. Immutability is opt-in and irreversible. This matters because the project has
 *      been saying "Studionet cannot upgrade a contract" — which is true of every deployment
 *      here, but true *by choice*, not by platform. That is a different claim and it needs
 *      checking against the source rather than restated.
 *
 * Run: node scripts/probe_code_and_upgrade.cjs
 */

const fs = require("fs");
const path = require("path");

const RPC = "https://studio.genlayer.com/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result;
}

const TRUSTS = [
  ["current source", "trust_c.address"],
  ["older build   ", "trust_b.address"],
];

(async () => {
  console.log("=== gen_getContractCode: can a reader verify what code is deployed? ===\n");
  for (const [label, file] of TRUSTS) {
    const address = fs.readFileSync(path.join(__dirname, file), "utf-8").trim();
    try {
      const code = await rpc("gen_getContractCode", [address]);
      const text = typeof code === "string" ? Buffer.from(code, "base64").toString("utf-8") : "";
      console.log(`  ${label}  ${address.slice(0, 12)}...`);
      console.log(`    returned ${typeof code === "string" ? code.length : "?"} base64 chars`);
      console.log(`    decodes to ${text.length} characters of source`);
      // Two markers that distinguish the builds by their own content, not by version string.
      const markers = [];
      if (/def _require_timelock/.test(text)) markers.push("_require_timelock");
      if (/def get_mission_log\(\s*self,\s*offset/.test(text)) markers.push("get_mission_log(offset,…)");
      if (/conserved_atto/.test(text)) markers.push("conserved_atto (six buckets)");
      console.log(`    build markers: ${markers.length ? markers.join(", ") : "none of the three"}`);
      fs.writeFileSync(
        path.join(__dirname, `.deployed_${path.basename(file)}.py`),
        text,
        "utf-8",
      );
      console.log(`    saved for diff: .deployed_${path.basename(file)}.py`);
    } catch (err) {
      console.log(`  ${label}  ${address.slice(0, 12)}...`);
      console.log(`    REFUSES: ${String(err.message).slice(0, 96)}`);
    }
    console.log("");
    await sleep(7000);
  }

  console.log("=== is the deployed code identical to the source in this repo? ===");
  {
    const local = fs.readFileSync(
      path.join(__dirname, "..", "contracts", "fideicommis.py"),
      "utf-8",
    );
    const deployedPath = path.join(__dirname, ".deployed_trust_c.address.py");
    if (!fs.existsSync(deployedPath)) {
      console.log("  no deployed copy captured, skipped");
    } else {
      const deployed = fs.readFileSync(deployedPath, "utf-8");
      const norm = (s) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
      console.log(`  local     ${norm(local).length} chars`);
      console.log(`  deployed  ${norm(deployed).length} chars`);
      console.log(`  identical: ${norm(local) === norm(deployed)}`);
    }
  }

  console.log("\n=== is this contract actually frozen, and by what? ===");
  {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "contracts", "fideicommis.py"),
      "utf-8",
    );
    const hasUpgradeMethod = /\n    def upgrade\b/.test(src);
    const touchesCodeSlot = /gl\.storage\.Root|code\.truncate|code\.extend/.test(src);
    console.log(`  declares an upgrade method:        ${hasUpgradeMethod}`);
    console.log(`  touches the code slot:             ${touchesCodeSlot}`);
    console.log(`  set_code_upgraders is the only code-identity surface: ${/def set_code_upgraders/.test(src)}`);
    console.log("");
    console.log("  Upgradability is opt-in per the docs: an address must appear in the root");
    console.log("  upgraders list to replace the code, and this contract never adds one unless an");
    console.log("  operator calls set_code_upgraders. So 'not upgradeable' is a property of these");
    console.log("  deployments, not a guarantee the platform makes.");
  }
})();