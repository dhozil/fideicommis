/**
 * Decoding a mission-log entry.
 *
 * This is a pure function and lives in `lib/` rather than inside the component for one
 * reason: it was wrong once and the type checker could not see it. The contract stores
 * each entry as a JSON document *inside a JSON string*, which `scripts/audit_new_views.cjs`
 * showed verbatim:
 *
 *     ["{\"event\": \"genesis\", \"mission\": \"Keep public climate-adaptation …\"}"]
 *
 * The first version of the Mission panel compared the newest entry against `get_mission`
 * as text. A JSON object is never equal to a sentence, so the panel would have reported
 * "the latest update does not match the declared mission" on every trust — including the
 * ones that had drifted least. A check that always fires is worse than no check, because
 * it teaches a reader to ignore the one comparison in the reader that puts two views of
 * the same fact side by side.
 *
 * It lives here so `tests/check_mission_log.mts` can import the real function. The
 * project's recurring failure is testing a copy of the logic, and a copy of a decoder is
 * a copy that can be correct while the one in the component is not.
 */

export interface MissionEntry {
  /** What happened, when the contract recorded it: "genesis", an amendment name, … */
  event?: string;
  /** The mission as it stood after this entry. The only field that can be compared. */
  mission?: string;
  /** The entry exactly as the contract returned it, kept when it could not be decoded. */
  raw: string;
}

/**
 * Decode one entry, accepting either encoding.
 *
 * The contract double-encodes today. Both shapes are accepted because a reader that only
 * handles the current shape is the reader that breaks when the contract changes, and the
 * change is a one-line edit in a contract whose storage layout this project has promised
 * never to reorder.
 *
 * An entry that decodes to nothing usable is returned with its raw text and no `mission`.
 * That distinction is the point: no `mission` means there is no evidence either way, so a
 * caller must not compare it. A decode failure is a fact about the reader's ability to
 * parse, not about the trust.
 */
export function decodeMissionEntry(raw: string): MissionEntry {
  const candidates = [raw];
  try {
    const inner = JSON.parse(raw) as unknown;
    if (typeof inner === "string") candidates.push(inner);
  } catch {
    /* not a JSON string, so the raw form is the only candidate */
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { event?: unknown; mission?: unknown };
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          event: typeof parsed.event === "string" ? parsed.event : undefined,
          mission: typeof parsed.mission === "string" ? parsed.mission : undefined,
          raw,
        };
      }
    } catch {
      /* try the next shape */
    }
  }

  return { raw };
}

/**
 * Whether the newest entry contradicts the declared mission.
 *
 * Returns true — "no contradiction found" — when there is no log, and when the newest
 * entry carries no mission to compare. Only an actual difference between two decoded
 * missions can report drift, so this cannot fire on a decoding failure or on a log that
 * simply has not been written yet.
 */
export function missionMatches(mission: string, entries: MissionEntry[]): boolean {
  const last = entries.length ? entries[entries.length - 1] : undefined;
  if (last?.mission === undefined) return true;
  return last.mission === mission;
}