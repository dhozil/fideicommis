import { bps } from "@/lib/format";
import type { ConstitutionalState } from "@/lib/types";

/**
 * A position on a track between two hard stops.
 *
 * The stops are hatched and the marker is solid, because the ends of these
 * tracks are the part a vote cannot move and the middle is the part it can. The
 * labels say what the ends mean rather than repeating the numbers, so a reader
 * learns the rule once instead of re-reading two figures.
 */
function Gauge({
  name,
  now,
  floor,
  roof,
  format,
  floorText,
  roofText,
}: {
  name: string;
  now: number;
  floor: number;
  roof: number;
  format: (v: number) => string;
  floorText: string;
  roofText: string;
}) {
  const span = roof - floor;
  const clamped = Math.max(0, Math.min(100, span <= 0 ? 0 : ((now - floor) / span) * 100));
  const outside = now < floor || now > roof;

  return (
    <div className="gauge">
      <div className="head">
        <span className="name">{name}</span>
        <span className="now">{format(now)}</span>
      </div>
      <div
        className="track"
        role="meter"
        aria-valuemin={floor}
        aria-valuemax={roof}
        aria-valuenow={now}
        aria-label={`${name}: ${format(now)}, between ${floorText} and ${roofText}`}
      >
        <span className="bed" />
        <span className="stop floor" />
        <span className="stop roof" />
        <span
          className="marker"
          style={{ left: `${clamped}%`, background: outside ? "var(--vermilion)" : "var(--brass)" }}
        />
      </div>
      <div className="ends">
        <span>{floorText}</span>
        <span>{roofText}</span>
      </div>
    </div>
  );
}

/**
 * The two numbers a vote can move, and the limits it cannot cross. Shown together
 * deliberately: "you cannot vote yourself past this" is a position on a track,
 * not a sentence to be trusted.
 */
export function ConstitutionGauges({ state }: { state: ConstitutionalState }) {
  return (
    <section className="block">
      <h2>Constitution</h2>
      <Gauge
        name="Quorum"
        now={state.quorum_bps}
        floor={state.min_quorum_bps}
        roof={10000}
        format={(v) => `${bps(v)} of shares`}
        floorText={`${bps(state.min_quorum_bps)} at the lowest`}
        roofText="every share"
      />
      <Gauge
        name="Spend ceiling"
        now={state.spend_ceiling_bps}
        floor={1}
        roof={state.max_spend_ceiling_bps}
        format={(v) => `${bps(v)} of the treasury, one grant`}
        floorText="as low as you like"
        roofText={`${bps(state.max_spend_ceiling_bps)} at the highest`}
      />
      <dl className="ledger ledger-spaced">
        <div className="ledger-row">
          <dt>Charter version</dt>
          <dd>{state.charter_version}</dd>
        </div>
        <div className="ledger-row">
          <dt>Delay on any change</dt>
          <dd>{Math.round(state.amendment_delay / 3600)} h</dd>
        </div>
        <div className="ledger-row">
          <dt>Total shares</dt>
          <dd>{state.total_shares.toLocaleString("en-US")}</dd>
        </div>
      </dl>
    </section>
  );
}
