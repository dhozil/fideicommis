import Link from "next/link";
import { notFound } from "next/navigation";
import { AddressForm } from "@/components/AddressForm";
import { KeeperActions } from "@/components/KeeperActions";
import { WalletPanel } from "@/components/WalletPanel";
import { Conservation } from "@/components/Conservation";
import { ConstitutionGauges } from "@/components/ConstitutionGauges";
import { DecisionList } from "@/components/Decision";
import { Charter, ConstitutionFacts, Membership, Rulebook } from "@/components/Panels";
import { gen, utc } from "@/lib/format";
import { NotATrust, readTrust } from "@/lib/trust";

// The record is a snapshot of a live chain, so it should not be baked into a build.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ address: string }> };

export default async function TrustPage({ params }: Params) {
  const { address } = await params;
  const decoded = decodeURIComponent(address);

  let record;
  try {
    record = await readTrust(decoded);
  } catch (err) {
    if (err instanceof NotATrust) notFound();
    throw err;
  }

  const cited = new Set(record.proposals.flatMap((p) => p.violations ?? []));

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">Fideicommis</span>
          <h1>{record.name}</h1>
          <div className="addr">{record.address}</div>
        </div>
        <div className="right">
          <div className="wallet">
            <WalletPanel />
          </div>
          <Link href="/">Read another</Link>
          <div>Studionet</div>
        </div>
      </header>

      <div className={record.constitutionConsistent ? "notice good" : "notice bad"}>
        {record.constitutionConsistent ? (
          <>
            {record.status} · cycle {record.cycle} · {gen(record.treasury)} GEN held · runway {record.runway} cycles · last action{" "}
            {record.lastAction} · next tick {utc(record.nextTickAt)}
          </>
        ) : (
          <>
            This contract&apos;s constitution view and its state view disagree about the hard limits, which means the deployed
            bytecode is not the code the reader expects. Treat this trust as unverified and do not read the figures below as
            meaningful.
          </>
        )}
      </div>

      {record.degraded ? (
        <div className="notice">
          Some views could not be read, and are shown as empty rather than guessed: <code>{record.degraded}</code>
        </div>
      ) : null}

      <div className="columns">
        <aside className="instrument">
          <Conservation flow={record.flow} />
          <ConstitutionGauges state={record.state} />
          <ConstitutionFacts record={record} />
          <KeeperActions trust={record.address} treasury={gen(record.treasury)} />
          <Membership
            members={record.members}
            totalShares={record.state.total_shares}
            ceiling={gen(record.policy.spend_ceiling_atto ?? "0")}
          />
          <Rulebook rules={record.rules} cited={cited} />
          <Charter charter={record.charter} version={record.charterVersion} />
        </aside>

        <main id="main" className="decisions">
          <h2 className="column-heading">
            {record.proposals.length} decision{record.proposals.length === 1 ? "" : "s"}, in the order they happened
          </h2>
          <DecisionList proposals={record.proposals} audits={record.audits} state={record.state} members={record.members} />
        </main>
      </div>

      <div className="colophon">
        <span className="read-only">Read-only</span> &nbsp;Nothing on this page was signed, and nothing can be from here. Each
        figure is a call to the trust&apos;s own view method, so a claim made here can be checked by making the same call.
        <div className="colophon-form">
          <AddressForm />
        </div>
      </div>
    </div>
  );
}
