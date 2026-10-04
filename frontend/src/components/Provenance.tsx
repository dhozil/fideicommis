"use client";

import { gen } from "@/lib/format";
import { decodeMissionEntry, missionMatches } from "@/lib/mission-log";

/**
 * The trust's declared purpose, and what has changed about it.
 *
 * The mission is a sentence the contract carries, and the mission log is every update to
 * it in order. Neither was displayed anywhere: `get_mission` and `get_mission_log`
 * answered on every read and nothing on any page showed either of them.
 *
 * A mission log that grows while the mission does not is a discrepancy worth starring
 * at. An update that the declared purpose does not reflect is either a drift nobody
 * noticed or a change made while no one was looking, and a panel that shows both may be
 * the only place the two are ever compared.
 */
export function Mission({ mission, missionLog }: { mission: string; missionLog: string[] }) {
  // The decoding lives in `lib/mission-log.ts` and is imported, not reimplemented: the
  // previous version compared the raw entry to the mission as text, which could never
  // match, and it reported drift on every trust. See that file for the shape the node
  // actually returns.
  const entries = missionLog.map(decodeMissionEntry);
  const matches = missionMatches(mission, entries);
  const last = entries.length ? entries[entries.length - 1] : undefined;
  const lastEntryText = last?.mission ?? last?.raw ?? "";

  return (
    <div>
      {mission ? (
        <p className="deed" style={{ margin: 0 }}>
          {mission}
        </p>
      ) : (
        <p className="faint" style={{ margin: 0 }}>
          The contract returned no mission.
        </p>
      )}
      {missionLog.length ? (
        <div style={{ marginTop: 12 }}>
          <span className="eyebrow" style={{ marginBottom: 6 }}>
            {missionLog.length} update{missionLog.length === 1 ? "" : "s"}
          </span>
          <ul className="log-list">
            {entries.map((entry, index) => (
              <li key={`mission-${index}`}>
                <code className="num">{index + 1}</code>
                <span>
                  {entry.event ? <span className="faint">{entry.event} · </span> : null}
                  {entry.mission ?? entry.raw}
                </span>
              </li>
            ))}
          </ul>
          {!matches ? (
            <p className="notice warn" style={{ marginTop: 10 }}>
              <strong>The latest update does not match the declared mission.</strong> The
              contract carries <code>{preview(mission)}</code> but the log&apos;s last
              entry is <code>{preview(lastEntryText)}</code>. One of the two is stale, and
              this page cannot say which.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="faint" style={{ margin: "10px 0 0" }}>
          No updates recorded.
        </p>
      )}
    </div>
  );
}

/** A bounded excerpt, because a charter or a mission can be arbitrarily long. */
function preview(text: string): string {
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}


/**
 * Where every figure on the page comes from, and which versions preceded this one.
 *
 * Three things here that no panel used to hold, and each of them is something the
 * project previously claimed only by assertion:
 *
 *   - `status` and `treasury` straight from their own views, shown beside the summary's
 *     versions of the same numbers. The summary is what the contract aggregates, so the
 *     two must agree — and a reader that showed only one could not tell when they did
 *     not.
 *   - `charterHistory`: every charter text that preceded this one, in order. A charter
 *     rewrite is the most consequential thing a trust can do to itself, and what it
 *     replaced was previously invisible.
 *   - `evidenceUrls`: what the committee is allowed to consult when it judges a
 *     proposal. The evidence sources were removed as an operator power precisely
 *     because controlling them is controlling the judgment — so what they currently
 *     are belongs on the record, and nowhere was showing them.
 */
export function Provenance({
  address,
  status,
  statusView,
  treasury,
  treasuryView,
  charterVersion,
  charterHistory,
  evidenceUrls,
}: {
  address: string;
  status: string;
  statusView: string;
  treasury: string;
  treasuryView: string;
  charterVersion: string;
  charterHistory: string[];
  evidenceUrls: string[];
}) {
  const statusMatches = statusView === "" || statusView === status;
  const treasuryMatches = treasuryView === "" || treasuryView === treasury;

  return (
    <div>
      <dl className="kv">
        <dt>Status</dt>
        <dd>
          {statusView ? (
            <>
              <code className="data">{statusView}</code>
              {!statusMatches ? (
                <span className="mark broken" style={{ marginLeft: 8 }}>
                  the summary says {status || "nothing"}
                </span>
              ) : null}
            </>
          ) : (
            <span className="faint">the summary says {status || "nothing"}</span>
          )}
        </dd>
        <dt>Treasury</dt>
        <dd>
          {treasuryView ? (
            <>
              <code className="data">{gen(treasuryView)} GEN</code>
              {!treasuryMatches ? (
                <span className="mark broken" style={{ marginLeft: 8 }}>
                  the summary holds {gen(treasury || "0")} GEN
                </span>
              ) : null}
            </>
          ) : (
            <span className="faint">as read by the summary: {gen(treasury || "0")} GEN</span>
          )}
        </dd>
        <dt>Charter</dt>
        <dd>
          version {charterVersion}
          {charterHistory.length ? (
            <>
              {" "}
              — {charterHistory.length} earlier text{charterHistory.length === 1 ? "" : "s"}
            </>
          ) : (
            <> — the first</>
          )}
        </dd>
      </dl>

      {charterHistory.length ? (
        <div style={{ marginTop: 12 }}>
          <span className="eyebrow" style={{ marginBottom: 6 }}>
            What came before
          </span>
          <ul className="log-list">
            {charterHistory.map((entry, index) => (
              <li key={`charter-${index}`}>
                <code className="num">v{index + 1}</code>
                <span>{entry}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <span className="eyebrow" style={{ marginBottom: 6 }}>
          What the committee may see
        </span>
        {evidenceUrls.length ? (
          <ul className="log-list">
            {evidenceUrls.map((url, index) => (
              <li key={`evidence-${index}`}>
                {url.startsWith("http") ? (
                  <a href={url} target="_blank" rel="noreferrer noopener">
                    {url}
                  </a>
                ) : (
                  <span>{url}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint" style={{ margin: 0 }}>
            No evidence sources listed. A grant cannot be judged compliant against
            nothing, so the committee will return UNDETERMINED until some are set.
          </p>
        )}
      </div>
    </div>
  );
}