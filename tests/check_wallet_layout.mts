/**
 * The wallet chooser fits, and the reasons it did not are checked here.
 *
 * A modal that does not fit is the project's own recurring failure in a new costume:
 * everything renders, every assertion passes, and the only place it shows up is a
 * rendered page at a viewport narrower than the one nobody tested on. So the four ways
 * this panel went wrong are asserted against the stylesheet, and each has a stated cause.
 *
 * Run: npx tsx@4 tests/check_wallet_layout.mts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "frontend", "src", "app", "globals.css"), "utf-8");
const chooser = readFileSync(
  join(here, "..", "frontend", "src", "components", "WalletChooser.tsx"),
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

/** The declarations inside one rule block, as a property -> value map. */
function rule(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return {};
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([a-z-]+)\s*:\s*(.+?);?\s*$/);
    if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

console.log("=== a wallet row is not a small-caps action button ===");
{
  // The panel lists wallets by the name each wallet gave for itself. The global `button`
  // rule sets font-family to the data face, 0.76rem, 0.1em tracking and UPPERCASE — so an
  // unstyled row rendered every wallet name as a shouted monospace label, which is both
  // wrong and wider than the row. The row has to opt back out of the button treatment.
  const row = rule(".wallet-row");
  check("the row is set in the prose face, not the data face", row["font-family"]?.includes("--prose") === true, row["font-family"] ?? "(unset)");
  check("names are not shouted", !row["text-transform"] || row["text-transform"] === "none", row["text-transform"] ?? "(unset)");
  check("tracking is normal, not the button's 0.1em", row["letter-spacing"] === "normal", row["letter-spacing"] ?? "(unset)");
  check("the row is flex, so icon and name sit on one line", row.display === "flex", row.display ?? "(unset)");
  check("the row is full width", row.width === "100%", row.width ?? "(unset)");
}

console.log();
console.log("=== a long wallet name wraps instead of overflowing ===");
{
  const name = rule(".wallet-name");
  check("the name may wrap onto a second line", name["overflow-wrap"]?.includes("anywhere") === true, name["overflow-wrap"] ?? "(unset)");
  // A flex child defaults to min-width:auto, so a long name refuses to shrink below its
  // own content width and pushes the row wider than the panel. This is the "it doesn't
  // fit" bug exactly: the panel is a fixed width and the row silently overflows it.
  check("the name can shrink below its content width", name["min-width"] === "0", name["min-width"] ?? "(unset)");
  check("the row itself is allowed to grow taller rather than clip", rule(".wallet-row")["align-items"] === "center" || rule(".wallet-row")["align-items"] === "flex-start", rule(".wallet-row")["align-items"] ?? "(unset)");
}

console.log();
console.log("=== the panel is bounded by the viewport on both axes ===");
{
  const panel = rule(".wallet-panel");
  check("it cannot exceed the viewport height", (panel["max-height"] ?? "").includes("vh") || (panel["max-height"] ?? "").includes("dvh"), panel["max-height"] ?? "(unset)");
  check("it is narrower than the screen", (panel["width"] ?? "").includes("min("), panel["width"] ?? "(unset)");
  check("it scrolls when it cannot fit", panel["overflow-y"] === "auto", panel["overflow-y"] ?? "(unset)");

  const modal = rule(".wallet-modal");
  // align-items:center with a panel taller than the viewport clips the top of the panel
  // and the close button with it. flex-start plus margin:auto centres it when it fits and
  // pins it to the top when it does not, which is the difference between a modal that is
  // always fully reachable and one that is not.
  check(
    "a tall panel is pinned to the top rather than centred into a clip",
    modal["align-items"] === "flex-start",
    modal["align-items"] ?? "(unset)",
  );
  check("it still centres when there is room", (panel["margin"] ?? "").includes("auto"), panel["margin"] ?? "(unset)");
}

console.log();
console.log("=== the modal owns the viewport, not the page ===");
{
  const modal = rule(".wallet-modal");
  check("it is fixed to the viewport", modal.position === "fixed", modal.position ?? "(unset)");
  check("it covers the viewport", modal.inset === "0", modal.inset ?? "(unset)");
  // Scrolling is taken from the page underneath while the modal is open. Without this the
  // page behind scrolls under the panel, which looks like the panel itself is moving.
  check("it captures its own scrolling", (modal["overscroll-behavior"] ?? "") === "contain", modal["overscroll-behavior"] ?? "(unset)");
}

console.log();
console.log("=== the chooser itself keeps the affordances it promises ===");
{
  check("Escape is handled", /event\.key === "Escape"/.test(chooser));
  check("Tab is trapped", /event\.key !== "Tab"/.test(chooser));
  check("it is announced as a dialog", /role="dialog"/.test(chooser) && /aria-modal="true"/.test(chooser));
  check("it has a labelled title", /aria-labelledby="wallet-chooser-title"/.test(chooser));
  check("the close control has an accessible name", /aria-label="Close"/.test(chooser));
  check("each wallet row is a real button", /className=\{`wallet-row/.test(chooser));
}

console.log();
console.log(failed ? `${failed} check(s) failed` : "the wallet chooser fits at any viewport");
if (failed) process.exit(1);