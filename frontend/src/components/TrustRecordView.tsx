"use client";

import { useEffect, useState } from "react";
import { TrustWrites } from "@/components/TrustWrites";
import { ProposalComposer } from "@/components/ProposalActions";
import { Conservation } from "@/components/Conservation";
import { ConstitutionGauges } from "@/components/ConstitutionGauges";
import { DecisionList } from "@/components/Decision";
import { Charter, ConstitutionFacts, Membership, Rulebook } from "@/components/Panels";
import { Mission, Provenance } from "@/components/Provenance";
import { RulesPanel } from "@/components/RulesActions";
import { gen, utc } from "@/lib/format";
import { addressOnExplorer } from "@/lib/explorer";
import type { TrustRecord } from "@/lib/types";

/**
 * The record, fetched in the browser, and every panel that shows it.
 *
 * The trust page used to await the chain in the server component, which meant no HTML
 * existed until fifteen view calls had returned. This is the other half of that change: the
 * page paints immediately and the record arrives over a second request, so the chain is not
 * in the path to a first paint.
 *
 * The rule this file is built around is that the fetch is not a licence to be vague. Four
 * states, all of which really happen and none of which is "something went wrong":
 *
 *   - waiting        the reads are in flight; say which calls and that nothing is shown yet
 *   - not a trust    404, an address that answers nothing — a wrong address, not an error
 *   - throttled      429, the node is rate-limiting; say so rather than showing a failure
 *   - record         200, including a record whose `degraded` views failed individually
 *
 * A degraded record is deliberately still a record. `readTrust` fills an unanswered view
 * instead of throwing, so the panels show what they can and the page names every view that
 * failed — which is the honest version, and the reason the Constitution panels guard
 * against a missing number rather than printing zero.
 */
export function TrustRecordView({ address }: { address: string }) {
  const [record, setRecord] = useState<TrustRecord | null>(null);
  const [problem, setProblem] = useState<{ kind: "not-a-trust" | "throttled"; message: string } | null>(
    null,
  );

  // `nonce` exists so the panels re-read their props after a write settles. `WritePanel`
  // bumps its own counter when a transaction returns, and the record is then refetched —
  // a write changes what every view method returns, so the figures on screen are stale the
  // moment one settles.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setRecord(null);
    setProblem(null);

    fetch(`/api/trust/${address}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as TrustRecord | { error: string };
        if (!live) return;
        if (response.status === 404) {
          setProblem({ kind: "not-a-trust", message: (body as { error: string }).error });
          return;
        }
        if (response.status === 429) {
          setProblem({ kind: "throttled", message: (body as { error: string }).error });
          return;
        }
        if (!response.ok) {
          setProblem({
            kind: "throttled",
            message: `The node answered ${response.status}. The figures below are from an earlier read, if any.`,
          });
          return;
        }
        setRecord(body as TrustRecord);
      })
      .catch((error: Error) => {
        // A fetch that never reached the server. Distinct from a 404 and from a refusal,
        // and saying so is more useful than "failed to load".
        if (live) setProblem({ kind: "throttled", message: error.message });
      });

    return () => {
      live = false;
    };
  }, [address, nonce]);

  if (problem?.kind === "not-a-trust") {
    return (
      <section style={{ marginTop: 28 }}>
        <div className="notice bad">
          <h1 style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.2rem)", margin: "0 0 8px" }}>
            Nothing answered at that address
          </h1>
          <p>{problem.message}</p>
          {/* The three reasons are ranked by how often they are the actual one, and the
              first is first because a reader who pasted their own wallet is far likelier
              than one who typed a bad character. Format validation cannot separate them:
              a wallet address and a contract address are the same 42 characters. */}
          <ul style={{ margin: "12px 0 0", paddingLeft: "20px", fontSize: "0.88rem" }}>
            <li>
              It is a <strong>wallet address</strong>, not a contract. A wallet answers no
              view methods, and it looks exactly like a contract address.
            </li>
            <li>
              It is a contract, but not a Fideicommis — any other GenLayer contract looks
              the same from here.
            </li>
            <li>
              It is a Fideicommis on <strong>another network</strong>. This reader reads
              Studionet; an address from testnet is a different contract entirely.
            </li>
          </ul>
          <p className="muted" style={{ margin: "12px 0 0", fontSize: "0.88rem" }}>
            A Fideicommis answers <code>get_org_name</code> and{" "}
            <code>get_constitution</code>. Try{" "}
            <a href="/trusts">the directory</a> for addresses that are known to answer.
          </p>
        </div>
      </section>
    );
  }

  if (problem) {
    return (
      <section style={{ marginTop: 28 }}>
        <div className="notice bad" role="alert">
          <strong>The record could not be read.</strong> {problem.message}
          <p className="muted" style={{ margin: "10px 0 0" }}>
            No figure is shown, because a figure that was not read is not zero.
          </p>
        </div>
      </section>
    );
  }

  if (!record) {
    return (
      <>
        <section style={{ marginTop: 28 }}>
          <div className="notice" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Reading the contract. This page
            makes fifteen <code>get_*</code> calls against the node, and nothing is shown
            until they answer.
          </div>
        </section>
        <hr className="rule" style={{ margin: "34px 0 26px" }} />
        <div className="columns">
          <aside className="stack" aria-label="The trust's standing">
            {[
              "Conservation",
              "Constitution",
              "Keeper",
              "Propose",
              "Rulebook & policy",
              "Membership",
              "Rulebook",
              "Charter",
              "Mission",
              "Provenance",
            ].map((heading) => (
              <div className="panel" key={heading}>
                <h3>{heading}</h3>
                <div className="skeleton skeleton-line" aria-hidden="true" />
                <div className="skeleton skeleton-line short" aria-hidden="true" />
              </div>
            ))}
          </aside>
        </div>
      </>
    );
  }

  const cited = new Set(record.proposals.flatMap((p) => p.violations ?? []));
  const consistent = record.constitutionConsistent;

  return (
    <>
      <section style={{ paddingTop: 30, marginTop: -30 }}>
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 320px" }}>
            <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.8rem)", margin: "10px 0 0" }}>
              {record.name}
            </h1>
            <p className="data muted wrap" style={{ marginTop: 8, marginBottom: 0 }}>
              {record.address}
            </p>
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              <a
                href={addressOnExplorer(record.address)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open on the explorer
              </a>
            </p>
          </div>
          <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
            {/* The seal is about this trust specifically: whether its constitution view
                and its state view agree. It lives here rather than in the header because
                the header is shared and this is not. */}
            <div className="seal">
              {consistent ? record.status : "unverified"}
              {consistent ? ` · cycle ${record.cycle}` : ""}
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        {consistent ? (
          <div className="notice good">
            {gen(record.treasury)} GEN held · runway {record.runway} cycles · last action{" "}
            {record.lastAction} · next tick {utc(record.nextTickAt)}
          </div>
        ) : (
          <div className="notice bad">
            <strong>This is not the code the reader expects.</strong> The constitution view
            and the state view disagree about the hard limits, which means the deployed
            bytecode is not the code this reader was written against. Treat every figure
            below as unverified and do not act on it.
          </div>
        )}

        {record.degraded ? (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <strong>Some views could not be read.</strong> They are shown empty rather than
            guessed: <code className="wrap">{record.degraded}</code>
          </div>
        ) : null}
      </section>

      <hr className="rule" style={{ margin: "34px 0 26px" }} />

      <div className="columns">
        <aside className="stack" aria-label="The trust's standing">
          <Conservation flow={record.flow} />
          <div className="panel">
            <h3>Constitution</h3>
            <ConstitutionGauges state={record.state} />
            <ConstitutionFacts record={record} />
          </div>
          <div className="panel">
            <h3>Keeper</h3>
            <TrustWrites
              trust={record.address}
              treasury={record.treasury}
              ceilingBps={record.policy.spend_ceiling_bps}
              maxCeilingBps={record.constitution.max_spend_ceiling_bps}
            />
          </div>
          <div className="panel">
            <h3>Propose</h3>
            <ProposalComposer
              trust={record.address}
              governanceFields={record.constitution.governance_fields}
            />
          </div>
          <div className="panel">
            <h3>Rulebook & policy</h3>
            <RulesPanel
              trust={record.address}
              hasRules={record.rules.length > 0}
              policy={record.policy}
              missing={record.missingWrites}
            />
          </div>
          <div className="panel">
            <h3>Membership</h3>
            <Membership
              members={record.members}
              totalShares={record.state.total_shares}
              ceiling={gen(record.policy.spend_ceiling_atto ?? "0")}
            />
          </div>
          <div className="panel">
            <h3>Rulebook</h3>
            <Rulebook rules={record.rules} cited={cited} />
          </div>
          <div className="panel">
            <h3>Charter</h3>
            <Charter charter={record.charter} version={record.charterVersion} />
          </div>
          <div className="panel">
            <h3>Mission</h3>
            <Mission mission={record.mission} missionLog={record.missionLog} />
          </div>
          <div className="panel">
            <h3>Provenance</h3>
            <Provenance
              address={record.address}
              status={record.status}
              statusView={record.statusView}
              treasury={record.treasury}
              treasuryView={record.treasuryView}
              charterVersion={record.charterVersion}
              charterHistory={record.charterHistory}
              evidenceUrls={record.evidenceUrls}
              codeUpgraders={record.codeUpgraders}
              upgradeabilityKnown={record.upgradeabilityKnown}
            />
          </div>
        </aside>

        <section aria-label="Decisions">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: "1.5rem" }}>
              {record.proposals.length} decision{record.proposals.length === 1 ? "" : "s"}
            </h2>
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              newest first, each with the committee&apos;s own reasoning
            </span>
          </div>
          <DecisionList
            proposals={record.proposals}
            audits={record.audits}
            state={record.state}
            members={record.members}
            trust={record.address}
            hasRules={record.rules.length > 0}
            missing={record.missingWrites}
          />
        </section>
      </div>
    </>
  );
}