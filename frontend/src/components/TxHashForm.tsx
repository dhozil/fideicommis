"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isTxHash } from "@/lib/address";

/**
 * Ask about one transaction.
 *
 * The address form above this reports figures, which are claims about state. This one
 * asks about a decision, which is a different thing: whether a write was agreed by a
 * committee or carried by one leader, and whether it happened at all. A reader can hold
 * a hash — from an explorer, from a failed wallet action, from someone else's claim —
 * and get the chain's own account of it.
 *
 * The shape is checked here so an obviously wrong hash is named rather than sent to the
 * node to come back as an opaque error, and so the field is not submitted at all until
 * it could succeed.
 */
export function TxHashForm({ label }: { label?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function inspect(event: React.FormEvent) {
    event.preventDefault();
    const hash = value.trim();
    if (!isTxHash(hash)) {
      setProblem(
        hash.length > 66
          ? "That is longer than a transaction hash. A GenLayer hash is 0x followed by exactly 64 hexadecimal characters, so paste the hash on its own rather than the whole explorer line."
          : "That is not a transaction hash. A GenLayer hash is 0x followed by 64 hexadecimal characters.",
      );
      return;
    }
    setProblem(null);
    router.push(`/verify?tx=${hash}`);
  }

  return (
    <form onSubmit={inspect} className="stack" style={{ marginTop: 22 }}>
      <label className="eyebrow" htmlFor="tx-hash" style={{ marginBottom: 0 }}>
        {label ?? "Paste a transaction hash"}
      </label>
      <div className="field">
        <input
          id="tx-hash"
          name="tx"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (problem) setProblem(null);
          }}
          placeholder="0x followed by 64 hex characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "tx-hash-problem" : undefined}
        />
        <button type="submit">Read the receipt</button>
      </div>
      {problem ? (
        <p
          id="tx-hash-problem"
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
