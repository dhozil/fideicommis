"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The address bar. A client component because it navigates; the page it lands on
 * is a server component that reads the chain, so no chain access happens here.
 */
export function AddressForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed) router.push(`/trust/${encodeURIComponent(trimmed)}`);
      }}
    >
      <div className="form-field">
        <label htmlFor="address">Fideicommis address</label>
        <input
          id="address"
          name="address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <button type="submit">Read the record</button>
    </form>
  );
}
