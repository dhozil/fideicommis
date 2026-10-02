"use client";

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
          placeholder="0x followed by 40 hex characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "trust-address-problem" : undefined}
        />
        <button type="submit">Open the record</button>
      </div>
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
