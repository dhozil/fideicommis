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
 * The two numbers a vote can move and the limits it cannot cross, shown together on
 * purpose. Below them, the parts of the constitution that are constants in the
 * contract rather than values in storage.
 */
export function ConstitutionGauges({ state }: { state: ConstitutionalState }) {
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
          ["Charter version", state.charter_version],
          ["Delay on any change", `${Math.round(state.amendment_delay / 3600)} h`],
          ["Total shares", state.total_shares.toLocaleString("en-US")],
        ]}
      />
    </>
  );
}
