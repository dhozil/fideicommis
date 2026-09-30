import Link from "next/link";
import { AddressForm } from "@/components/AddressForm";

/** A live trust deployed from the current source, so the reader has something to open. */
const EXAMPLE = process.env.NEXT_PUBLIC_EXAMPLE_TRUST ?? "0x89D3E2F937a265583BF308F2d5250445e1f7113F";

export default function Home() {
  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">Fideicommis</span>
          <h1>The audit record</h1>
        </div>
        <div className="right">Studionet · read-only</div>
      </header>

      <main id="main">
        <section className="hero">
          <h2>A trust that cannot explain a decision cannot be audited.</h2>
          <p>
            This reader takes the address of a <strong>Fideicommis</strong> and shows what its own contract says: whether the
            money is accounted for to the last attoGEN, where the quorum and the spend ceiling sit against limits a vote cannot
            cross, and for every proposal the committee&apos;s own reasoning and the text it actually judged.
          </p>
          <p>
            It signs nothing and holds no key. Everything here can be checked by calling the same <code>get_*</code> method
            yourself.
          </p>

          <AddressForm />

          <p className="hint">
            No address to hand? <Link href={`/trust/${EXAMPLE}`}>Open a live trust deployed from the current source.</Link>
          </p>
        </section>

        <div className="colophon">
          <span className="read-only">Read-only</span> &nbsp;This reader calls the contract&apos;s view methods and nothing else.
          There is no write path in the application, no account, and no private key in the build.
        </div>
      </main>
    </div>
  );
}
