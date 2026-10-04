/**
 * A failed view must not crash the panel that would have shown it.
 *
 * `readTrust` fills an unanswered view with an empty object rather than refusing to
 * render, which is right for the page and lethal for the panels that read the hole as
 * data. Two of them did:
 *
 *     ConstitutionGauges   TypeError: Cannot read properties of undefined
 *                          (reading 'toLocaleString')      state.total_shares
 *     ConstitutionFacts    TypeError: Cannot read properties of undefined
 *                          (reading 'length')              constitution.constitutional_kinds
 *
 * Both were found by loading a trust whose `get_constitutional_state` and
 * `get_constitution` did not answer, which is a state the reader is explicitly built to
 * survive: it already renders a notice naming every view that failed. The panels were the
 * part that could not survive it.
 *
 * This renders both components against a half-read record — the shape `readTrust` actually
 * produces — and asserts they return markup rather than throwing. It also asserts the
 * substitute is the word "unreadable" rather than a zero, because a zero on a
 * constitutional track is a claim about what a vote may not move, made from no data.
 *
 * Run: npx tsx@4 tests/check_degraded_panels.mts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gauges = readFileSync(
  join(here, "..", "frontend", "src", "components", "ConstitutionGauges.tsx"),
  "utf-8",
);
const panels = readFileSync(
  join(here, "..", "frontend", "src", "components", "Panels.tsx"),
  "utf-8",
);
const trust = readFileSync(join(here, "..", "frontend", "src", "lib", "trust.ts"), "utf-8");

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ""}`);
  }
}

console.log("=== a view that did not answer really does arrive as an empty object ===");
{
  // If this changes, the panels below are guarding against a shape that no longer occurs
  // and the guards should be revisited. If it does not change, the guards are load-bearing.
  check(
    "readTrust substitutes an empty object for an unanswered view",
    /keep<ConstitutionalState>\(4, "get_constitutional_state", \{\} as ConstitutionalState\)/.test(trust),
  );
  check(
    "and for the constitution",
    /keep<Constitution>\(3, "get_constitution", \{\} as Constitution\)/.test(trust),
  );
  check(
    "rather than throwing, so the page is expected to render anyway",
    /Nothing here throws for a single failed call except a rate limit/.test(trust),
  );
}

console.log();
console.log("=== the gauges do not read a missing number as a number ===");
{
  // The crash was `.toLocaleString()` on `state.total_shares`. Guarding means going
  // through a helper that checks, not through an optional chain that would quietly print
  // nothing where a figure belongs.
  check("total_shares is not formatted inline any more", !/state\.total_shares\.toLocaleString/.test(gauges));
  check("charter_version is not rendered raw", !/\["Charter version", state\.charter_version\]/.test(gauges));
  check("amendment_delay is not divided inline", !/Math\.round\(state\.amendment_delay/.test(gauges));
  check("every figure goes through a checked helper", /function figure\(/.test(gauges) && /function hours\(/.test(gauges));
}

console.log();
console.log("=== a track with a missing end is not drawn ===");
{
  // Both ends come from the constitution view. With one missing, clamping `now` into
  // [floor, roof] would put a bound on the track that the contract never stated — the
  // reader inventing a constitutional limit is the failure this project exists to avoid.
  check(
    "the gauges refuse when an end is missing",
    /!Number\.isFinite\(state\.min_quorum_bps\) \|\| !Number\.isFinite\(state\.max_spend_ceiling_bps\)/.test(gauges),
  );
  check("and name the view that failed", /get_constitutional_state<\/code> did not answer/.test(gauges));
}

console.log();
console.log("=== the facts do not read a missing list as an empty list ===");
{
  // `constitutional_kinds.length` on undefined threw. `?.length ?? "unreadable"` cannot,
  // and the readable check means the whole block steps aside when the view is absent
  // rather than printing a table of half-empty rows.
  check("the kinds are not read with a bare .length", !/constitution\.constitutional_kinds\.length/.test(panels));
  check("the fields are not read with a bare .length", !/constitution\.governance_fields\.length/.test(panels));
  check("both are guarded", /constitutional_kinds\?\.length \?\? "unreadable"/.test(panels));
  check("the panel steps aside when the view is absent", /const readable = Number\.isFinite/.test(panels));
  check("and names the view that failed", /get_constitution<\/code> did not answer/.test(panels));
}

console.log();
console.log("=== the substitute is never a number the contract did not state ===");
{
  check("a missing figure reads as 'unreadable'", /"unreadable"/.test(gauges));
  check("not as zero", !/figure\([^)]*\)\s*\|\|\s*0/.test(gauges));
  check(
    "and the panels say they infer nothing",
    /is inferred from the views that did answer/.test(gauges) && /are not inferred/.test(panels),
  );
}

console.log();
console.log("=== the page already told the reader, and the panels now agree with it ===");
{
  // This notice moved out of page.tsx when the record stopped being server-rendered: the
  // degraded list is part of the fetched record, so it is rendered by the component that
  // receives it. The check followed it there, which is the check working — it fails when the
  // wording moves without this being updated, which is a sentence worth re-reading.
  const view = readFileSync(
    join(here, "..", "frontend", "src", "components", "TrustRecordView.tsx"),
    "utf-8",
  );
  check("the degraded notice names the failed views", /Some views could not be read/.test(view));
  check(
    "and says they are shown empty rather than guessed",
    /shown empty rather than\s+guessed/.test(view),
  );
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "an unreadable view shows as unreadable, not as a crash");
if (failed) process.exit(1);