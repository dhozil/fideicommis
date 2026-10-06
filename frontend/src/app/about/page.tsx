import type { Metadata } from "next";
import Link from "next/link";
import { FEATURED_TRUST } from "@/lib/registry";

export const metadata: Metadata = {
  title: "What this is",
  description:
    "The claims this project makes, and the three boundaries around them.",
};

/**
 * The boundaries, stated once.
 *
 * Anything a contract can enforce, the code and its tests already say. Three
 * facts sit outside that and are stated here rather than repeated in every
 * document: each live trust has one member, nothing here has been independently
 * reviewed, and this is a testnet. A project that published only the enforced
 * list would be overselling itself.
 */

const ENFORCED = [
  "The operator cannot change membership, the rulebook, the evidence sources, the quorum or the ceiling. Each of those was reachable in an earlier build and each is now refused at the contract, not at the interface in front of it.",
  "Quorum cannot go below 25% and the spending ceiling cannot go above 50%, because those are constants in the code rather than values in storage.",
  "A constitutional change cannot take effect before its delay, and the delay is stamped when quorum is reached rather than when the proposal is submitted.",
  "A charter amendment with no charter text cannot execute. The model may suggest prose; the prose has to be carried by a member.",
  "Every payment declares which conservation bucket it draws from, and an unrecognised bucket is refused before value moves.",
  "The four operator paths that used to exist are asserted as refused against a live deployment, not only in-process.",
];

const NOT_ENFORCED = [
  {
    claim: "Each live trust has one member.",
    honest: "One member holding every share, so one approval satisfies quorum. The contract removes the operator's ability to manufacture that arrangement unilaterally. It cannot create pluralism.",
  },
  {
    claim: "Nothing here has been independently reviewed.",
    honest: "Contract, reader, and tests written by one person, running on the Studionet testnet with no real value at stake. Before putting anything that matters in a trust you cannot leave, have somebody who did not write it read it.",
  },
  {
    claim: "The node is public property.",
    honest: "Reads come from a public node at thirty a minute. It is sometimes busy, and a busy node looks like an empty page rather than an error.",
  },
];

export default function About() {
  return (
    <main id="main">
      <section style={{ paddingTop: 34 }}>
        <span className="eyebrow">The boundaries</span>
        <h1 style={{ maxWidth: "15ch" }}>
          What this is.
        </h1>
        <p className="lede" style={{ marginTop: 18 }}>
          An autonomous trust is an estate entrusted in perpetuity and left to its own
          devices. It is explicitly not a DAO. Three facts sit around that claim,
          stated here once.
        </p>
      </section>

      <section className="prose" style={{ marginTop: 40 }}>
        <span className="eyebrow">Enforced by the contract</span>
        <h2 style={{ maxWidth: "24ch" }}>
          Things you can check by reading the code, and that a vote cannot change.
        </h2>
        <div className="guarantees" style={{ marginTop: 22 }}>
          {ENFORCED.map((item, index) => (
            <div className="guarantee" key={item}>
              <div className="key">{String(index + 1).padStart(2, "0")}</div>
              <div className="why" style={{ marginBottom: 0 }}>
                {item}
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" style={{ margin: "48px 0 34px" }} />

      <section className="prose">
        <span className="eyebrow">Boundaries</span>
        <h2 style={{ maxWidth: "24ch" }}>
          Three facts, stated once.
        </h2>
        <p>
          A contract can refuse an operation. It cannot create a second member, it
          cannot review itself, and it cannot reserve a public node. These are the
          three.
        </p>
        <div style={{ marginTop: 24 }}>
          {NOT_ENFORCED.map((item) => (
            <div className="guarantee" key={item.claim}>
                <div className="key" style={{ color: "var(--brass)" }}>
                  boundary
                </div>
              <div>
                <div className="claim">{item.claim}</div>
                <p className="why">{item.honest}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" style={{ margin: "44px 0 34px" }} />

      <section className="prose">
        <span className="eyebrow">Deploying one</span>
        <h2 style={{ maxWidth: "22ch" }}>Whoever deploys a trust chose to.</h2>
        <p>
          There is no factory and no template key. An earlier version had one, and it
          was removed because a single address could permanently fix the code that
          every future trust would run, with no governance path out of it. In a
          project whose whole claim is that the operator cannot manufacture authority
          unilaterally, that was the same capture as the others, and it was the
          operator&apos;s to use.
        </p>
        <p>
          So the deployment is one command and the contract is one file.{" "}
          <code>node deploy/deployScript.ts</code> deploys it, reads the name and the
          constitution back, and prints the address. Two steps are left to you on
          purpose: deriving the rulebook from your charter, and funding it. Anyone can
          do the second.
        </p>
        <p style={{ marginBottom: 0 }}>
          Then open it: <Link href={`/trust/${FEATURED_TRUST}`}>the reference trust</Link>,
          or any address you deploy yourself.
        </p>
      </section>

      <section style={{ marginTop: 40 }}>
        <div className="notice warn" style={{ maxWidth: "64ch" }}>
          <strong>Testnet, single author, unreviewed.</strong> Before putting anything
          that matters in a trust you cannot leave, have somebody who did not write
          it read it.
        </div>
      </section>

      <p className="faint" style={{ marginTop: 26, fontSize: "0.84rem", maxWidth: "58ch" }}>
        Figures on this site are shown in GEN, and the accounting underneath them is in
        attoGEN throughout: one GEN is a billion billion attoGEN, which is why a grant
        can be exact rather than rounded.
      </p>
    </main>
  );
}
