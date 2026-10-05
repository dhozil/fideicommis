"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress } from "@/lib/address";

/**
 * Open a trust by address.
 *
 * The check happens here rather than only on the target page, because a mistyped
 * address used to produce a 404 with no explanation, which reads as "this trust
 * does not exist" when the truth is "that is not an address". Saying which of the
 * two it is costs nothing.
 *
 * The bigger problem this had was not a missing check but a misleading hint. The placeholder
 * said "0x followed by 40 hex characters", which is true of every EVM address in existence
 * and so reads as "any Ethereum address". It is not: the address has to be a GenLayer
 * Intelligent Contract deployed on Studionet. A wallet address is the same shape and answers
 * nothing, and no amount of format validation can tell them apart — only the chain can, and
 * only after a round trip.
 *
 * So the hint names the chain and the kind of thing, and points at the two places a reader
 * can actually get one. A hint that lets someone paste their MetaMask address and then shows
 * them a 404 has told them the wrong thing about what this form accepts.
 */
export function AddressForm({ label }: { label?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function open(event: React.FormEvent) {
    event.preventDefault();
    const address = value.trim();
    if (!isAddress(address)) {
      setProblem(
        "That is not a contract address. A GenLayer address is 0x followed by 40 hexadecimal characters.",
      );
      return;
    }
    setProblem(null);
    router.push(`/trust/${address}`);
  }

  return (
    <form onSubmit={open} className="stack" style={{ marginTop: 22 }}>
      <label
        className="eyebrow"
        htmlFor="trust-address"
        style={{ marginBottom: 0 }}
      >
        {label ?? "Open a trust by its address"}
      </label>
      <div className="field">
        <input
          id="trust-address"
          name="address"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (problem) setProblem(null);
          }}
          placeholder="A Fideicommis contract on Studionet"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "trust-address-problem" : "trust-address-hint"}
        />
        <button type="submit">Open the record</button>
      </div>
      {/* The hint is always visible rather than only on focus, because the mistake it
          prevents — pasting a wallet address — is made before the field is ever touched. */}
      <p
        id="trust-address-hint"
        className="faint"
        style={{ fontSize: "0.82rem", margin: "8px 0 0", maxWidth: "54ch" }}
      >
        The address of a{" "}
        <strong>Fideicommis contract deployed on GenLayer Studionet</strong> — not a
        wallet address, and not an Ethereum one. A wallet is the same shape and answers
        nothing, so it shows as &ldquo;nothing answered at that address&rdquo; rather than
        as an error.
      </p>
      <p className="faint" style={{ fontSize: "0.82rem", margin: "6px 0 0", maxWidth: "54ch" }}>
        To find one:{" "}
        <Link href="/trusts">the directory</Link>, the{" "}
        <a
          href="https://explorer-studio.genlayer.com"
          target="_blank"
          rel="noreferrer noopener"
        >
          Studionet explorer
        </a>
        , or the address your own{" "}
        <code>deployScript.ts</code> run printed.
      </p>
      {problem ? (
        <p
          id="trust-address-problem"
          role="alert"
          className="muted"
          style={{ fontSize: "0.84rem", margin: 0, maxWidth: "none" }}
        >
          {problem}
        </p>
      ) : null}
    </form>
  );
}
