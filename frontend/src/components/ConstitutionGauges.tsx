import { bps } from "@/lib/format";
import type { ConstitutionalState } from "@/lib/types";

/**
 * A limit drawn as a position on a track.
 *
 * The ends of these tracks are the part a vote cannot move and the middle is the
 * part it can, so the ends are labelled with what they mean rather than with their
 * numbers, and the fill is green inside the range and red outside it. "You cannot
 * vote yourself past this" is a position on a track, not a sentence to be trusted.
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
      <div className="gauge-head">
        <span>{name}</span>
        <span className="value">{format(now)}</span>
      </div>
      <div
        className="gauge-track"
        role="meter"
        aria-valuemin={floor}
        aria-valuemax={roof}
        aria-valuenow={now}
        aria-label={`${name}: ${format(now)}, between ${floorText} and ${roofText}`}
      >
        <span className={`gauge-fill ${outside ? "over" : ""}`} style={{ width: `${clamped}%` }} />
      </div>
      <div className="gauge-floor">
        <span>{floorText}</span>
        <span>{roofText}</span>
      </div>
    </div>
  );
}

/** A small two-column list of figures, used by several panels. */
export function Facts({ rows }: { rows: [string, string | number][] }) {
  return (
    <table>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td style={{ color: "var(--ink-dim)" }}>{label}</td>
            <td className="num">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A figure, or the reason it is absent.
 *
 * A view that fails to answer leaves a hole in the record, and `readTrust` fills the hole
 * with an empty object rather than refusing to render. That is the right call for the page
 * and the wrong one for these panels if they read the hole as data: `state.total_shares`
 * came back `undefined` and `.toLocaleString()` on it threw, so a trust whose
 * `get_constitutional_state` did not answer crashed the Constitution panel instead of
 * saying so. Both errors below are the same error, and the page already names the failed
 * views in its own degraded notice — this just stops the panel from dying first.
 *
 * The substitute is the word "unreadable" rather than a zero. A zero here would be a
 * figure on a track showing a limit the contract may not have, which is the one thing this
 * reader must never invent.
 */
function figure(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "unreadable";
}

function hours(seconds: number | undefined): string {
  return typeof seconds === "number" && Number.isFinite(seconds) ? `${Math.round(seconds / 3600)} h` : "unreadable";
}

/**
 * The two numbers a vote can move and the limits it cannot cross, shown together on
 * purpose. Below them, the parts of the constitution that are constants in the contract
 * rather than values in storage.
 */
export function ConstitutionGauges({ state }: { state: ConstitutionalState }) {
  // A track needs both ends. If either is missing there is no track to draw, and drawing
  // one from a half-read view would put a limit on it that the contract never stated.
  if (!Number.isFinite(state.min_quorum_bps) || !Number.isFinite(state.max_spend_ceiling_bps)) {
    return (
      <p className="faint" style={{ fontSize: "0.84rem", margin: "0 0 10px" }}>
        <code>get_constitutional_state</code> did not answer, so the limits a vote cannot
        cross are not shown. Nothing here is inferred from the views that did answer.
      </p>
    );
  }

  return (
    <>
      <Gauge
        name="Quorum"
        now={state.quorum_bps}
        floor={state.min_quorum_bps}
        roof={10000}
        format={(v) => `${bps(v)} of shares`}
        floorText={`${bps(state.min_quorum_bps)}, the lowest a vote may set`}
        roofText="every share"
      />
      <Gauge
        name="Spend ceiling"
        now={state.spend_ceiling_bps}
        floor={1}
        roof={state.max_spend_ceiling_bps}
        format={(v) => `${bps(v)} of the treasury, one grant`}
        floorText="as low as you like"
        roofText={`${bps(state.max_spend_ceiling_bps)}, the highest a vote may set`}
      />
      <Facts
        rows={[
          ["Charter version", figure(state.charter_version)],
          ["Delay on any change", hours(state.amendment_delay)],
          ["Total shares", figure(state.total_shares)],
        ]}
      />
    </>
  );
}
