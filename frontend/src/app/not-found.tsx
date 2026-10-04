import { NotATrust } from "@/lib/trust";
import { AddressForm } from "@/components/AddressForm";

export const dynamic = "force-dynamic";

/**
 * A 404 that teaches. An auditor who typed the wrong address, or pointed at
 * something that is not a Fideicommis, should learn what the reader expects
 * rather than read "404".
 */
export default function NotFound() {
  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">Fideicommis</span>
          <h1>Nothing answered at that address</h1>
        </div>
        <div className="right">Studionet</div>
      </header>

      <main id="main">
        <div className="notice">
          Either the address is not a Fideicommis on Studionet, or it is a contract without this interface. A Fideicommis
          answers <code>get_org_name</code> and <code>get_constitution</code>; an address that is not a deployed contract
          answers nothing at all.
        </div>
        <section className="hero hero-tight">
          <AddressForm />
        </section>
      </main>
    </div>
  );
}
