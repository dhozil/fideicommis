/**
 * A mission-log entry is decoded, or the drift warning lies.
 *
 * The contract stores each mission-log entry as a JSON document *inside a JSON string*,
 * and it was found that way: `scripts/audit_new_views.cjs` returned, verbatim,
 *
 *     ["{\"event\": \"genesis\", \"mission\": \"Keep public climate-adaptation …\"}"]
 *
 * The first version of the Mission panel compared the newest entry to `get_mission` as raw
 * text. A JSON object and a sentence are never equal, so the panel would have shown "the
 * latest update does not match the declared mission" on *every* trust, including the one
 * that had drifted least. A warning that always fires is not a warning, and it would have
 * been worse than no panel at all: it teaches a reader to ignore the only check in the
 * reader that compares two views of the same fact against each other.
 *
 * This imports the decoder the component uses. An earlier version of this file extracted
 * the function out of the component's source with a regular expression, which is a test of
 * a transcription — and a transcription can be correct while the real code is not. The
 * decoder moved to `lib/mission-log.ts` so it can be imported.
 *
 * Run: npx tsx@4 tests/check_mission_log.mts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { decodeMissionEntry, missionMatches } from "../frontend/src/lib/mission-log.ts";

const here = dirname(fileURLToPath(import.meta.url));
const provenance = readFileSync(
  join(here, "..", "frontend", "src", "components", "Provenance.tsx"),
  "utf-8",
);

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

// Exactly what Studionet returned for get_mission_log(0, 20) on the deployed trust,
// taken verbatim from scripts/audit_new_views.cjs.
const NODE_ANSWER =
  '["{\\"event\\": \\"genesis\\", \\"mission\\": \\"Keep public climate-adaptation reference material continuously reachable.\\", \\"org\\": \\"Open Archive Trust\\"}"]';

const MISSION = "Keep public climate-adaptation reference material continuously reachable.";

console.log("=== the shape the node actually returns decodes to the mission ===");
{
  const parsed = JSON.parse(NODE_ANSWER) as string[];
  check("the array holds one entry", parsed.length === 1);
  const entry = decodeMissionEntry(parsed[0] as string);
  check("the event is decoded", entry.event === "genesis", entry.event ?? "(none)");
  check("the mission is decoded exactly", entry.mission === MISSION, entry.mission ?? "(none)");
  check("and it matches get_mission", missionMatches(MISSION, [entry]) === true);
}

console.log();
console.log("=== a raw comparison would have cried drift on a trust that has not drifted ===");
{
  const raw = (JSON.parse(NODE_ANSWER) as string[])[0] as string;
  // Kept so the failure stays visible rather than being quietly deleted.
  check("the raw entry is not equal to the mission", raw !== MISSION);
  check("so a text comparison reports drift", !(raw === MISSION));
  check("while the decoded comparison does not", decodeMissionEntry(raw).mission === MISSION);
  check("and the panel says no drift", missionMatches(MISSION, [decodeMissionEntry(raw)]) === true);
}

console.log();
console.log("=== both encodings are accepted ===");
{
  // The contract double-encodes today. A contract that stops doing so must not break the
  // panel, and a reader that only handles the current shape is the reader that breaks
  // when it changes.
  const doubleEncoded = JSON.stringify(JSON.stringify({ event: "amended", mission: "A new purpose." }));
  check("double-encoded decodes", decodeMissionEntry(doubleEncoded).mission === "A new purpose.");

  const singleEncoded = JSON.stringify({ event: "amended", mission: "A new purpose." });
  check("single-encoded decodes", decodeMissionEntry(singleEncoded).mission === "A new purpose.");
}

console.log();
console.log("=== drift is reported only on a real difference ===");
{
  const changed = decodeMissionEntry(JSON.stringify(JSON.stringify({ event: "amended", mission: "Something else entirely." })));
  check("a different mission is drift", missionMatches(MISSION, [changed]) === false);
  check("and it says which", changed.mission === "Something else entirely.");
}

console.log();
console.log("=== an entry that cannot be decoded is shown, never compared ===");
{
  const broken = decodeMissionEntry("this is not JSON at all");
  check("it carries the raw text", broken.raw === "this is not JSON at all");
  // No mission field means no evidence either way. Comparing on the raw text would invent
  // a mismatch out of a decoding failure — a warning about the reader dressed up as a
  // warning about the trust.
  check("and offers no mission to compare against", broken.mission === undefined);
  check("so it is not reported as drift", missionMatches(MISSION, [broken]) === true);
}

console.log();
console.log("=== an empty log is not drift either ===");
{
  check("no entries means no contradiction", missionMatches(MISSION, []) === true);
}

console.log();
console.log("=== the panel uses the shared decoder rather than its own ===");
{
  check("it imports from lib/mission-log", /from "@\/lib\/mission-log"/.test(provenance));
  check("it does not compare raw text any more", !/normalize\(/.test(provenance));
  check("it holds no second copy of the decoder", !/function decodeMissionEntry/.test(provenance));
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "the drift warning can only fire on real drift");
if (failed) process.exit(1);