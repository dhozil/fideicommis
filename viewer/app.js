/*
 * Fideicommis audit viewer.
 *
 * Read-only. Every figure on this page comes from a view method on the contract
 * itself, so anything shown here can be re-checked by calling the same method.
 * Nothing is signed, nothing is written, and the page has no account concept at
 * all.
 *
 * The one inference it makes is quorum feasibility: the contract does not expose
 * who approved a proposal, so when a single member holds at least the quorum
 * share we can say that one approval was sufficient, and when it cannot be
 * determined we say so rather than guessing.
 */

const DEFAULT_TRUST = "0x89D3E2F937a265583BF308F2d5250445e1f7113F";
const GEN = 1e18;

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ fetch */

async function rpc(method, args = []) {
  const q = new URLSearchParams({ address: current, method, args: JSON.stringify(args) });
  let res;
  try {
    res = await fetch(`/api/call?${q}`);
  } catch (err) {
    throw new Error(`${method}: the reader at localhost is not answering (${err.message})`);
  }
  const body = await res.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    // The node's own limiter answers with an HTML page, not JSON. Saying so is
    // the difference between "wait a minute" and "this trust is broken".
    throw new Error(
      body.trimStart().startsWith("<")
        ? `${method}: the node returned a web page, not a result. It is rate-limiting this IP. Wait about a minute, then read again.`
        : `${method}: the reader did not answer with JSON`,
    );
  }
  if (!res.ok || payload.error) {
    throw new Error(`${method}: ${payload.error || res.status}`);
  }
  return payload.result;
}

/* Some views answer with a JSON string and some answer with a plain string; the
   SDK may hand either back already parsed. So this accepts both and fails with a
   message that names the method and shows what actually came back, rather than a
   bare "is not valid JSON" that tells an auditor nothing. */
async function rpcJSON(method, args = []) {
  const raw = await rpc(method, args);
  if (raw !== null && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${method} did not return JSON; it returned ${JSON.stringify(String(raw).slice(0, 80))}`);
  }
}

/* One call at a time, in order, with the count shown. Sixteen simultaneous
   requests look efficient and are what gets the reader throttled: Studionet
   allows 30 a minute and answers the overflow with an HTML page that no JSON
   client can read. Serialising costs a few seconds and keeps the reading
   dependable. */
async function readAll(tasks) {
  const out = new Array(tasks.length);
  for (let i = 0; i < tasks.length; i += 1) {
    const [key, method, args] = tasks[i];
    $("notice").innerHTML = `Reading ${esc(addr(current))} from Studionet. ${i + 1} of ${tasks.length}: <code>${method}</code>. The node allows 30 reads a minute.`;
    out[i] = await (key === "json" ? rpcJSON(method, args) : rpc(method, args));
  }
  return out;
}

/* -------------------------------------------------------------- formatting */

const gen = (atto) => (Number(atto) / GEN).toFixed(6);

function addr(a) {
  if (!a) return "—";
  return a.length > 12 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

function clock(unix) {
  if (!unix) return "—";
  return new Date(Number(unix) * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function ledger(host, rows) {
  host.innerHTML = rows
    .map(([k, v, strong]) => `<div class="row"><span class="k">${k}</span><span class="v${strong ? " strong" : ""}">${v}</span></div>`)
    .join("");
}

/* -------------------------------------- SIGNATURE: the conservation ledger */

/* The identity the contract can be falsified against:
     inflow == treasury + granted + settled + dissolved + keeper_paid + burned
   It is rendered as a row of figures that must total, because that is what it
   is. If it does not balance, the page says so in words and in red. */
function renderConservation(flow) {
  const terms = [
    ["Treasury", flow.treasury_atto],
    ["Granted", flow.granted_atto],
    ["Settled", flow.settled_atto],
    ["Dissolved", flow.dissolved_atto],
    ["Rewarded", flow.keeper_paid_atto],
    ["Burned", flow.burned_atto],
  ];
  const sum = terms.reduce((a, [, v]) => a + Number(v), 0);
  const holds = sum === Number(flow.inflow_atto);

  $("terms").innerHTML = terms
    .map(([label, v]) => {
      const z = Number(v) === 0 ? " zero" : "";
      return `<div class="term${z}"><span class="label">${label}</span><span class="value">${gen(v)}</span></div>`;
    })
    .join("");

  $("equation").className = `equation ${holds ? "holds" : "broken"}`;
  $("rhs").textContent = `${gen(sum)} of ${gen(flow.inflow_atto)}`;
  $("balanceVerdict").textContent = holds
    ? "Every attoGEN that entered is still somewhere"
    : `Does not balance. ${gen(Math.abs(sum - Number(flow.inflow_atto)))} GEN unaccounted for.`;

  ledger($("flowLedger"), [
    ["Entered, lifetime", `${gen(flow.inflow_atto)} GEN`, true],
    ["Left, lifetime", `${gen(flow.outflow_atto)} GEN`],
    ["Reported by the view", `${gen(flow.conserved_atto)} GEN`],
    ["Disagreement", holds ? "none" : "the view and the identity differ"],
  ]);
}

/* ---------------------------------------------------- constitutional gauge */

/* A position on a track between two hard stops. The stops are hatched and the
   marker is solid, because the ends cannot be voted away and the middle can. */
function renderGauges(state) {
  const gauges = [
    ["Quorum", state.quorum_bps, state.min_quorum_bps, 10000, (b) => `${(b / 100).toFixed(0)}% of shares`, "25% of shares", "every share"],
    ["Spend ceiling", state.spend_ceiling_bps, 1, state.max_spend_ceiling_bps, (b) => `${(b / 100).toFixed(1)}% of the treasury, one grant`, "as low as you like", "50% of the treasury"],
  ];
  $("gauges").innerHTML = gauges
    .map(([name, now, floor, roof, fmt, floorText, roofText]) => {
      const pct = (v) => `${Math.max(0, Math.min(100, ((v - floor) / (roof - floor)) * 100))}%`;
      return `<div class="gauge">
        <div class="head"><span class="name">${name}</span><span class="now">${fmt(now)}</span></div>
        <div class="track">
          <span class="bed"></span>
          <span class="stop floor"></span>
          <span class="stop roof"></span>
          <span class="marker" style="left:${pct(now)}"></span>
        </div>
        <div class="ends"><span class="hard">${floorText}</span><span class="hard">${roofText}</span></div>
      </div>`;
    })
    .join("");

  ledger($("constitutionLedger"), [
    ["Charter version", state.charter_version],
    ["Delay on any change", `${(state.amendment_delay / 3600).toFixed(0)} h`],
    ["Total shares", state.total_shares],
  ]);
}

/* ------------------------------------------------------- the decision chain */

/* Steps are numbered because here they are genuinely ordered: money cannot leave
   before it is proposed, judged, and voted, and the settlement cannot happen
   before the delivery is reviewed. */
function chain(p, quorumHeld) {
  const steps = [];
  const add = (n, what, got, cls) => steps.push({ n, what, got, cls });

  add("Proposed", "Anyone may", "on the record", "done");

  if (p.verdict === "PENDING") {
    add("Judged", "Committee assessment", "not yet assessed", "waiting");
  } else if (p.verdict === "NON_COMPLIANT") {
    add("Judged", "Committee assessment", "NON_COMPLIANT", "blocked");
  } else if (p.verdict === "COMPLIANT") {
    add("Judged", "Committee assessment", "COMPLIANT", "done");
  } else {
    add("Judged", "Committee assessment", p.verdict, "waiting");
  }

  if (Number(p.rejections) > 0) {
    add("Voted", `${p.approvals} for, ${p.rejections} against`, "rejected", "blocked");
  } else if (quorumHeld === false) {
    add("Voted", `${p.approvals} approval${Number(p.approvals) === 1 ? "" : "s"}`, "quorum not reached", "blocked");
  } else if (Number(p.approvals) === 0) {
    add("Voted", "no votes yet", "not started", "waiting");
  } else {
    add("Voted", `${p.approvals} approval${Number(p.approvals) === 1 ? "" : "s"}`, "quorum met", "done");
  }

  if (p.kind === "CHARTER_AMENDMENT" || p.kind === "GOVERNANCE") {
    if (p.executed) {
      add("In force", "Constitutional change", "took effect", "done");
    } else if (quorumHeld && Number(p.approvals) > 0) {
      add("In force", "Constitutional change", "waiting out the delay", "waiting");
    } else {
      add("In force", "Constitutional change", "not approved", "na");
    }
    // Grants and settlements are meaningless for a charter rewrite.
    add("Paid", "Grant released", "not a grant", "na");
    add("Reviewed", "Delivery reviewed", "not a grant", "na");
    add("Settled", "Remainder settled", "not a grant", "na");
    return steps;
  }

  add("Funded", p.executed ? "Grant released" : "Awaiting release", p.executed ? gen(p.amount_atto) : "not paid out", p.executed ? "done" : "waiting");

  if (p.delivery_verdict === "NONE") {
    add("Reviewed", "Delivery reviewed", "not reviewed", "waiting");
  } else if (p.delivery_verdict === "ACCEPTED") {
    add("Reviewed", `Delivery reviewed, scored ${p.delivery_score}`, gen(p.delivery_payout), "done");
  } else {
    add("Reviewed", "Delivery reviewed", p.delivery_verdict, "blocked");
  }

  add(
    "Settled",
    "Remainder settled",
    p.settled ? gen(p.delivery_payout) : "not settled",
    p.settled ? "done" : "waiting",
  );
  return steps;
}

function renderDecisions(ids, records, audits, state, members) {
  const host = $("decisions");
  if (!ids.length) {
    host.innerHTML = '<p class="empty">This trust has no proposals yet.</p>';
    return;
  }

  // Quorum feasibility: with one member holding at least the quorum share, a
  // single approval is enough. If no single member could meet quorum, we cannot
  // tell from the views alone and say nothing rather than assume.
  const totalShares = Number(state.total_shares) || 1;
  const biggest = members.reduce((a, m) => Math.max(a, Number(m.shares)), 0);
  const quorumHeld = (biggest * 10000) / totalShares >= Number(state.quorum_bps);

  host.innerHTML = ids
    .map((id) => {
      const p = records[id];
      const audit = audits[id] || {};
      const isConstitutional = p.kind === "CHARTER_AMENDMENT" || p.kind === "GOVERNANCE";

      let chop = `<span class="chop ${p.verdict === "NON_COMPLIANT" ? "bad" : p.verdict === "PENDING" ? "pend" : ""}">${p.verdict.toLowerCase()}</span>`;
      if (p.delivery_verdict && p.delivery_verdict !== "NONE") {
        chop += ` <span class="chop ${p.delivery_verdict === "ACCEPTED" ? "" : "bad"}">${p.delivery_verdict.toLowerCase()}</span>`;
      }

      const steps = chain(p, quorumHeld)
        .map((s) => `<div class="step ${s.cls}"><div class="n">${s.n}</div><div class="what">${s.what}</div><div class="got">${s.got}</div></div>`)
        .join("");

      const why = [];
      if (audit.rationale) {
        why.push(`<div class="why-block"><div class="attribution">The committee's reasoning for the verdict</div><p>${esc(audit.rationale)}</p></div>`);
      }
      if (audit.delivery_rationale) {
        why.push(`<div class="why-block"><div class="attribution">The committee's reasoning for the delivery</div><p>${esc(audit.delivery_rationale)}</p></div>`);
      }
      if (audit.body) {
        why.push(`<div class="why-block"><div class="attribution">The text that was actually voted on</div><p>${esc(audit.body)}</p></div>`);
      }

      let hold = "";
      if (isConstitutional && !p.executed && quorumHeld && Number(p.approvals) > 0) {
        hold = `<div class="hold">Approved, but not in force. A constitutional change does not
          take effect the moment it is voted on; it has to sit through its
          ${(Number(state.amendment_delay) / 3600).toFixed(0)}-hour delay first.
          <span class="when">The contract records when quorum was reached, but does not expose
          that timestamp as a view, so the remaining time cannot be read from here.
          Reading <code>get_proposal_audit(${p.id})</code> and the block time of the vote is
          the way to check it.</span></div>`;
      }

      const violations = (p.violations || []).length
        ? `<div class="why"><strong>Rules cited as broken:</strong> ${(p.violations || []).map(esc).join(", ")}</div>`
        : "";

      return `<article class="decision">
        <div class="head">
          <span class="pid">${p.id}</span>
          <span class="kind">${p.kind.replace(/_/g, " ")}</span>
          <h3>${esc(p.title)}</h3>
        </div>
        ${chop}
        ${violations}
        <div class="chain">${steps}</div>
        <div class="why">
          ${p.recipient ? `To <strong>${addr(p.recipient)}</strong>, a non-member beneficiary.` : "No recipient: nothing was paid out."}
          ${Number(p.amount_atto) > 0 ? ` Asked for <strong>${gen(p.amount_atto)} GEN</strong>.` : ""}
        </div>
        ${hold}
        ${why.join("")}
      </article>`;
    })
    .join("");
}

/* The contract records when a constitutional proposal reached quorum, but does
   not expose that timestamp as a view, so this page does not pretend to know how
   much of the delay is left. It states the delay and says how to check. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ------------------------------------------------------------------- load */

let current = "";

async function load(address) {
  current = address.trim();
    $("notice").className = "notice";
    $("notice").textContent = `Reading ${addr(current)} from Studionet. The RPC allows 30 reads a minute, so this takes a moment.`;
    $("go").disabled = true;

    const records = {};
    const audits = {};

  try {
    const [
      name, status, cycle, treasury, runway, nextTick, lastAction,
      flow, constitution, state, policy, members, rules, charter, charterVersion, ids,
    ] = await readAll([
      ["raw", "get_org_name"], ["raw", "get_status"], ["raw", "get_cycle"], ["raw", "get_treasury"],
      ["raw", "get_runway_cycles"], ["raw", "get_next_tick_at"], ["raw", "get_last_action"],
      ["json", "get_lifetime_flow"], ["json", "get_constitution"], ["json", "get_constitutional_state"],
      ["json", "get_policy"], ["json", "get_members"], ["json", "get_charter_rules"],
      ["raw", "get_charter"], ["raw", "get_charter_version"], ["json", "get_proposal_ids"],
    ]);

    $("name").textContent = name;
    $("address").textContent = current;
    document.title = `${name} — Fideicommis audit`;

    const s = state;
    const immutable = constitution;
    let summary;
    if (immutable.min_quorum_bps !== s.min_quorum_bps || immutable.max_spend_ceiling_bps !== s.max_spend_ceiling_bps) {
      $("notice").className = "notice bad";
      summary = "The contract's own constitution view and its state view disagree about the hard limits. Treat this trust as unverified.";
    } else {
      $("notice").className = "notice good";
      summary = `${status} · cycle ${cycle} · ${gen(treasury)} GEN held · runway ${runway} cycles · last action ${lastAction} · next tick ${clock(nextTick)}`;
    }
    $("notice").textContent = summary;

    renderConservation(flow);
    renderGauges(s);
    ledger($("members"), members.map((m) => [
      addr(m.address),
      `${Number(m.shares).toLocaleString()} shares (${((m.shares / s.total_shares) * 100).toFixed(1)}%)`,
    ]).concat([["Ceiling on one grant", `${gen(policy.spend_ceiling_atto)} GEN`]]));

    $("charterVersion").textContent = `version ${charterVersion}`;
    $("charter").textContent = charter;

    const cited = new Set();
    for (const id of ids) {
      $("notice").innerHTML = `Reading the audit record for <code>${esc(id)}</code>. ${cited.size + 1} of ${ids.length}.`;
      const rec = await rpcJSON("get_proposal", [id]);
      const audit = await rpcJSON("get_proposal_audit", [id]);
      records[id] = rec;
      audits[id] = audit;
      (rec.violations || []).forEach((v) => cited.add(v));
    }

    $("rules").innerHTML = rules
      .map((r) => `<li class="${cited.has(r.id) ? "cited" : ""}"><span class="rid">${r.id}</span><span>${esc(r.text)}</span></li>`)
      .join("") || '<li class="empty">No rulebook derived yet.</li>';

    renderDecisions(ids, records, audits, s, members);
    $("notice").textContent = summary;
    $("pacer").textContent = `${ids.length * 2 + 16} view calls for this trust, made one at a time. Raising the address bar reads a different trust.`;
    history.replaceState(null, "", `#${current}`);
  } catch (err) {
    $("notice").className = "notice bad";
    $("notice").innerHTML = `Could not read that trust. ${esc(err.message)}<br>Start the reader with <code>node scripts/serve_viewer.cjs</code>, and check the address is a deployed Fideicommis on Studionet.`;
  } finally {
    $("go").disabled = false;
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  load($("trust").value);
});

const fromHash = location.hash.slice(1);
$("trust").value = fromHash || DEFAULT_TRUST;
load($("trust").value);
