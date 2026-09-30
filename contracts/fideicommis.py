# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re


ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

STATUS_ACTIVE = "ACTIVE"
STATUS_DORMANT = "DORMANT"
STATUS_WINDING_DOWN = "WINDING_DOWN"
STATUS_DISSOLVED = "DISSOLVED"

KIND_GRANT = "GRANT"
KIND_CHARTER_AMENDMENT = "CHARTER_AMENDMENT"
KIND_GOVERNANCE = "GOVERNANCE"
# Changes to the constitution or the constitution's own machinery. Every one of
# them waits out the timelock after reaching quorum, so a capture is observable
# before it takes effect.
CONSTITUTIONAL_KINDS = (KIND_CHARTER_AMENDMENT, KIND_GOVERNANCE)
VALID_PROPOSAL_KINDS = (KIND_GRANT, KIND_CHARTER_AMENDMENT, KIND_GOVERNANCE)
GOV_FIELD_QUORUM = "QUORUM_BPS"
GOV_FIELD_CEILING = "SPEND_CEILING_BPS"
GOV_FIELD_SHARES = "MEMBER_SHARES"
GOV_FIELD_RULES = "CHARTER_RULES"
GOV_FIELD_EVIDENCE = "EVIDENCE_URLS"
GOVERNANCE_FIELDS = (GOV_FIELD_QUORUM, GOV_FIELD_CEILING, GOV_FIELD_SHARES, GOV_FIELD_RULES, GOV_FIELD_EVIDENCE)
# Hard constitutional limits. These are not policy and cannot be raised by a vote
# or an amendment: a trust may make itself stricter, never looser than this.
MIN_QUORUM_BPS = 2500
MAX_SPEND_CEILING_BPS = 5000
# A sanity bound against a nonsense allocation, not a security property. The real
# limit on one member dominating is the share split itself, and a single member
# holding everything is exactly the pluralism failure the README admits to.
MAX_SHARES_PER_MEMBER = 1000000
DEFAULT_AMENDMENT_DELAY = 3600

VERDICT_PENDING = "PENDING"
VERDICT_COMPLIANT = "COMPLIANT"
VERDICT_NON_COMPLIANT = "NON_COMPLIANT"
VERDICT_UNDETERMINED = "UNDETERMINED"

DELIVERY_NONE = "NONE"
DELIVERY_ACCEPTED = "ACCEPTED"
DELIVERY_REJECTED = "REJECTED"
DELIVERY_UNDETERMINED = "UNDETERMINED"

ACTION_SETTLE = "SETTLE"
ACTION_FUND = "FUND"
ACTION_ADAPT = "ADAPT"
ACTION_HOLD = "HOLD"
ACTION_WIND_DOWN = "WIND_DOWN"

VALID_ACTIONS = (ACTION_SETTLE, ACTION_FUND, ACTION_ADAPT, ACTION_HOLD, ACTION_WIND_DOWN)
PAYING_ACTIONS = (ACTION_FUND, ACTION_SETTLE)

MAX_RULES = 12
MAX_EVIDENCE_URLS = 3
MAX_LOG = 500
MAX_PROPOSAL_SCAN = 20
EVIDENCE_CLIP = 4000
RATIONALE_CLIP = 400
# Substrings identifying which conservation bucket a payout belongs to. They are
# matched against the payout memo inside _pay, so every outflow is attributed to
# exactly one bucket and the sum is checkable.
BUCKET_GRANT = "grant"
BUCKET_SETTLE = "settlement"
BUCKET_DISSOLUTION = "dissolution"
ENTRY_CLIP = 1200
BODY_CLIP = 4000
CHARTER_CLIP = 8000
ACCEPT_THRESHOLD = 50


@gl.evm.contract_interface
class _ChainAccount:
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class CharterRule:
    id: str
    text: str


@allow_storage
@dataclass
class Proposal:
    proposer: Address
    title: str
    body: str
    kind: str
    amount_atto: u256
    recipient: str
    created_at: str
    cycle: u256
    verdict: str
    has_violation: bool
    rationale: str
    confidence: u256
    approvals: u256
    rejections: u256
    executed: bool
    delivery_verdict: str
    delivery_score: u256
    delivery_payout: u256
    delivery_rationale: str
    settled: bool


def _clip(value, limit: int) -> str:
    text = str(value).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)] + "..."


def _to_address(value) -> Address:
    """Accept either a hex string or an already decoded Address.

    A real GenVM node hands constructor and method address arguments over as
    Address objects, while Studio and direct mode pass a plain hex string, and
    Address(...) rejects an Address. Normalising here keeps both paths working.
    """
    if isinstance(value, Address):
        return value
    return Address(value)


def _parse_url_list(raw) -> list:
    if isinstance(raw, list):
        candidates = [str(item) for item in raw]
    else:
        text = str(raw).strip()
        if text == "":
            return []
        candidates = [line.strip() for line in text.split("\n")]
    urls = []
    for candidate in candidates:
        if candidate == "":
            continue
        if not candidate.startswith("https://"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} evidence url must start with https://: {candidate}")
        urls.append(_clip(candidate, 512))
    if len(urls) > MAX_EVIDENCE_URLS:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} at most {MAX_EVIDENCE_URLS} evidence urls are allowed")
    return urls


def _http_status(response) -> int:
    for attribute in ("status_code", "status"):
        value = getattr(response, attribute, None)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
    return 200


def _response_text(response) -> str:
    body = getattr(response, "body", "")
    if isinstance(body, bytes):
        return body.decode("utf-8", "ignore")
    return str(body)


def _fetch_source(url: str) -> str:
    """Non-deterministic: must be called from inside a leader/validator block."""
    try:
        response = gl.nondet.web.get(url)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence source unreachable: {url}")
    status = _http_status(response)
    if status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence source returned {status}: {url}")
    if status >= 400:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} evidence source returned {status}: {url}")
    text = _response_text(response).strip()
    if text == "":
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} evidence source returned an empty body: {url}")
    return text


def _collect_evidence(urls: list) -> str:
    """Non-deterministic: must be called from inside a leader/validator block."""
    blocks = []
    for url in urls:
        try:
            blocks.append("<source url=\"%s\">\n%s\n</source>" % (_clip(url, 300), _clip(_fetch_source(url), EVIDENCE_CLIP)))
        except gl.vm.UserError as failure:
            message = failure.message if hasattr(failure, "message") else str(failure)
            blocks.append("<source url=\"%s\" unavailable>\n%s\n</source>" % (_clip(url, 300), _clip(message, 200)))
    return "\n\n".join(blocks)


def _truncate_decimal(text: str):
    """json.loads hook that keeps model supplied decimals out of the VM entirely.

    GenVM emulates floats in software and their rounding is not something a
    consensus rule should depend on. A decimal in a model response is always a
    score or a confidence, never an amount, so it is truncated toward zero here
    and the rest of the contract only ever sees integers. Returns None for
    exponent notation such as 1e5, which _pick_int then treats as absent.
    """
    candidate = str(text).strip()
    negative = candidate.startswith("-")
    if negative or candidate.startswith("+"):
        candidate = candidate[1:]
    whole, dot, fraction = candidate.partition(".")
    if whole == "" and fraction == "":
        return None
    if not whole.isdigit():
        return None
    if dot and fraction != "" and not fraction.isdigit():
        return None
    value = int(whole)
    return -value if negative else value


def _scrub_floats(value):
    """Replace every float in decoded model output with an integer.

    _parse_json_object handles the text path with a parse_float hook, but the SDK
    may hand back an already decoded dict when response_format="json" is used.
    Routing both through here means no float ever reaches a consensus rule, and
    int() on a float is exact truncation toward zero with no rounding involved.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, dict):
        scrubbed = {}
        for key in value:
            scrubbed[key] = _scrub_floats(value[key])
        return scrubbed
    if isinstance(value, list):
        scrubbed_list = []
        for item in value:
            scrubbed_list.append(_scrub_floats(item))
        return scrubbed_list
    return value


def _parse_json_object(raw) -> dict:
    if isinstance(raw, dict):
        return _scrub_floats(raw)
    text = str(raw)
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1 or last < first:
        raise gl.vm.UserError(f"{ERROR_LLM} no JSON object found in model output")
    cleaned = re.sub(r",(?!\s*?[\{\[\"'\w])", "", text[first:last + 1])
    try:
        parsed = json.loads(cleaned, parse_float=_truncate_decimal)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_LLM} model output was not parsable JSON")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} model output JSON root is not an object")
    return _scrub_floats(parsed)


def _pick_str(payload: dict, keys, default: str = "") -> str:
    for key in keys:
        if key in payload and payload[key] is not None:
            return str(payload[key]).strip()
    return default


def _parse_int_text(text):
    """Integer-only parsing for a model supplied number. No float arithmetic."""
    candidate = str(text).strip()
    if candidate == "":
        return None
    negative = candidate.startswith("-")
    if negative or candidate.startswith("+"):
        candidate = candidate[1:]
    whole, dot, fraction = candidate.partition(".")
    if whole == "" and fraction == "":
        return None
    if not whole.isdigit():
        return None
    if dot and fraction != "" and not fraction.isdigit():
        return None
    value = int(whole)
    return -value if negative else value


def _pick_int(payload: dict, keys, default: int = 0) -> int:
    """Read an integer decision field from a model response.

    Every accepted value is a Python int produced by integer operations only, so
    leader and validators cannot diverge because of float rounding.
    """
    for key in keys:
        if key in payload and payload[key] is not None:
            raw = payload[key]
            if isinstance(raw, bool):
                return 1 if raw else 0
            if isinstance(raw, int):
                return raw
            if isinstance(raw, str):
                parsed = _parse_int_text(raw)
                if parsed is not None:
                    return parsed
            if isinstance(raw, float):
                return int(raw)
    return default


def _as_str_list(payload: dict, keys) -> list:
    for key in keys:
        if key in payload and isinstance(payload[key], list):
            return [_clip(item, 200) for item in payload[key] if str(item).strip()]
    return []


def _now_unix() -> int:
    """Seconds since the epoch, the same clock advance_cycle uses for the tick."""
    return int(datetime.now(timezone.utc).timestamp())


def _confidence_bucket(confidence: int) -> int:
    if confidence < 0:
        return 0
    if confidence > 100:
        return 5
    return confidence // 20


def _buckets_within_tolerance(leader_bucket: int, validator_bucket: int, tolerance: int) -> bool:
    return abs(leader_bucket - validator_bucket) <= tolerance


@allow_storage
class Fideicommis(gl.Contract):
    # Published so a deployment checker can assert these are the numbers, rather
    # than trusting that a deployer read them somewhere. The hard limits are
    # constants precisely because they are not adjustable; a checker that reads
    # them from here can confirm the deployed bytecode was not tampered with.
    CONSTITUTION = json.dumps({
        "min_quorum_bps": MIN_QUORUM_BPS,
        "max_spend_ceiling_bps": MAX_SPEND_CEILING_BPS,
        "amendment_delay": DEFAULT_AMENDMENT_DELAY,
        "constitutional_kinds": list(CONSTITUTIONAL_KINDS),
        "governance_fields": list(GOVERNANCE_FIELDS),
    }, sort_keys=True)
    org_name: str
    mission: str
    charter: str
    charter_version: u256
    charter_history: DynArray[str]
    charter_rules: DynArray[CharterRule]
    founder: Address
    operator: Address
    members: DynArray[Address]
    member_shares: TreeMap[Address, u256]
    total_shares: u256
    quorum_bps: u256
    evidence_urls: DynArray[str]
    treasury: u256
    lifetime_inflow: u256
    lifetime_outflow: u256
    burn_per_cycle: u256
    keeper_reward: u256
    tick_interval: u64
    next_tick_at: u64
    last_tick_at: u64
    cycle: u256
    status: str
    spend_ceiling_bps: u256
    proposals: TreeMap[str, Proposal]
    proposal_order: DynArray[str]
    proposal_violations: TreeMap[str, DynArray[str]]
    proposal_approvers: TreeMap[str, DynArray[str]]
    proposal_rejecters: TreeMap[str, DynArray[str]]
    proposal_count: u256
    executed_count: u256
    settled_count: u256
    tick_count: u256
    keeper_count: u256
    total_keeper_paid: u256
    mission_log: DynArray[str]
    log_truncated: bool
    last_action: str
    last_rationale: str
    # Everything below is APPENDED. GenLayer's storage layout is positional, so a
    # field inserted in the middle would silently reinterpret every field after
    # it. Append only.
    lifetime_granted: u256
    lifetime_settled: u256
    lifetime_dissolved: u256
    # Seconds a constitutional change must sit approved but not executed before it
    # may be executed. This is the window in which members and auditors can see a
    # captured trust about to hand itself over and react.
    amendment_delay: u64
    # When a constitutional proposal reached quorum and therefore became
    # executable. The timelock is measured from this, not from submission, so a
    # proposal that sat unvoted for a month does not execute instantly once
    # approved.
    op_ready_at: TreeMap[str, u64]

    def __init__(self, org_name: str, mission: str, charter: str, operator: str, evidence_urls: str):
        self.org_name = _clip(org_name, 120)
        self.mission = _clip(mission, 2000)
        self.charter = _clip(charter, CHARTER_CLIP)
        self.charter_version = u256(1)
        self.founder = gl.message.sender_address
        self.operator = _to_address(operator)
        self.members.append(self.founder)
        self.member_shares[self.founder] = u256(10000)
        self.total_shares = u256(10000)
        self.quorum_bps = u256(5000)
        self.spend_ceiling_bps = u256(2000)
        self.treasury = u256(0)
        self.lifetime_inflow = u256(0)
        self.lifetime_outflow = u256(0)
        self.burn_per_cycle = u256(0)
        self.keeper_reward = u256(0)
        self.tick_interval = u64(3600)
        self.next_tick_at = u64(0)
        self.last_tick_at = u64(0)
        self.cycle = u256(0)
        self.tick_count = u256(0)
        self.status = STATUS_ACTIVE
        self.last_action = ACTION_HOLD
        self.log_truncated = False
        self.lifetime_granted = u256(0)
        self.lifetime_settled = u256(0)
        self.lifetime_dissolved = u256(0)
        # The founding numbers. Quorum and the spend ceiling are constitutional:
        # set once here, then reachable only through a charter amendment that
        # itself needs a member vote and the timelock.
        self.amendment_delay = u64(DEFAULT_AMENDMENT_DELAY)
        for url in _parse_url_list(evidence_urls):
            self.evidence_urls.append(url)
        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)
        self._log({"event": "genesis", "org": self.org_name, "mission": self.mission})

    # ------------------------------------------------------------------
    # funding and policy
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def fund(self) -> None:
        received = int(gl.message.value)
        if received <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fund() must be called with GEN value")
        current = str(self.status)
        if current == STATUS_WINDING_DOWN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fideicommis is winding down and cannot take funds")
        if current == STATUS_DISSOLVED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fideicommis is dissolved and cannot take funds")
        self.treasury = u256(int(self.treasury) + received)
        self.lifetime_inflow = u256(int(self.lifetime_inflow) + received)
        if current == STATUS_DORMANT:
            self.status = STATUS_ACTIVE
            self._log({"event": "revived", "amount_atto": str(received), "cycle": int(self.cycle)})
        self._log({"event": "fund", "amount_atto": str(received), "status": str(self.status)})

    @gl.public.write
    def set_policy(
        self,
        burn_per_cycle: int,
        keeper_reward: int,
        tick_interval: int,
    ) -> None:
        """
        Operational policy only: what the estate burns, what a keeper is paid, and
        how often the cycle may run.

        Quorum and the spend ceiling are deliberately NOT parameters here. They
        used to be, which meant a single operator could raise the ceiling to
        10000 bps and drop quorum to 1 bp in one call, then use the resulting
        single-member quorum to vote through anything, including a charter that
        removed the ceiling. Those two numbers are constitutional now: they are
        fixed at genesis and only move through the amendment path, which needs a
        member vote and then waits out the timelock.
        """
        self._require_operator()
        if int(tick_interval) < 60:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} tick_interval must be at least 60 seconds")
        if int(burn_per_cycle) < 0 or int(keeper_reward) < 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} burn and keeper reward cannot be negative")
        self.burn_per_cycle = u256(burn_per_cycle)
        self.keeper_reward = u256(keeper_reward)
        self.tick_interval = u64(tick_interval)
        self._log({
            "event": "policy",
            "burn_per_cycle": str(burn_per_cycle),
            "keeper_reward": str(keeper_reward),
            "tick_interval": str(tick_interval),
            "quorum_bps": str(int(self.quorum_bps)),
            "spend_ceiling_bps": str(int(self.spend_ceiling_bps)),
        })

    @gl.public.write
    def set_evidence_urls(self, urls: str) -> None:
        """
        Removed as an operator power.

        The evidence sources decide what the committee can see, so controlling
        them is controlling the judgment. That was the fourth step of the capture
        sequence: point the judge at sources that make anything look compliant. It
        is a governance proposal now.
        """
        raise gl.vm.UserError(f"{ERROR_EXPECTED} evidence sources are constitutional, submit a GOVERNANCE proposal with EVIDENCE_URLS:<urls> instead")

    @gl.public.write
    def set_code_upgraders(self, upgraders: str) -> None:
        self._require_operator()
        addresses = []
        for entry in str(upgraders).split(","):
            candidate = entry.strip()
            if candidate == "":
                continue
            addresses.append(_to_address(candidate))
        if len(addresses) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} at least one upgrader address is required")
        root = gl.storage.Root.get()
        existing = root.upgraders.get()
        while len(existing) > 0:
            existing.pop()
        for address in addresses:
            existing.append(address)

    # ------------------------------------------------------------------
    # membership
    # ------------------------------------------------------------------

    @gl.public.write
    def set_member_shares(self, member: str, shares: int) -> None:
        """
        Removed as a power, not as a function.

        This used to be operator-only, and it was the first step of every capture:
        make yourself the sole member, then vote alone. Membership is now a
        governance proposal, which needs a member vote and then waits out the
        timelock before it can take effect. The method stays so the refusal is
        explicit rather than a confusing "unknown method" at call time.
        """
        raise gl.vm.UserError(f"{ERROR_EXPECTED} membership is constitutional, submit a GOVERNANCE proposal with MEMBER_SHARES:MEMBER:SHARES instead")

    # ------------------------------------------------------------------
    # charter: rulebook extraction and amendment
    # ------------------------------------------------------------------

    @gl.public.write
    def bootstrap_rules(self) -> None:
        self._require_live()
        if len(self.charter_rules) > 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} charter rules already derived for this version")
        charter_text = str(self.charter)
        mission_text = str(self.mission)
        result = self._derive_rules(charter_text, mission_text)
        for entry in result["rules"]:
            self.charter_rules.append(CharterRule(id=str(entry["id"]), text=str(entry["text"])))
        self._log({
            "event": "rules_bootstrapped",
            "charter_version": int(self.charter_version),
            "rule_count": len(self.charter_rules),
        })

    @gl.public.write
    def clear_rules(self) -> None:
        """
        Removed as an operator power, for the same reason as set_member_shares:
        wiping the rulebook is a constitutional act, and it is now a governance
        proposal that needs a vote and the timelock.
        """
        raise gl.vm.UserError(f"{ERROR_EXPECTED} charter rules are constitutional, submit a GOVERNANCE proposal with CHARTER_RULES:clear instead")

    # ------------------------------------------------------------------
    # proposals
    # ------------------------------------------------------------------

    @gl.public.write
    def submit_proposal(self, title: str, body: str, kind: str, amount_atto: int, recipient: str) -> str:
        self._require_live()
        if kind not in VALID_PROPOSAL_KINDS:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} kind must be one of {', '.join(VALID_PROPOSAL_KINDS)}")
        if kind == KIND_GRANT and _clip(recipient, 64) == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} grant proposals require a recipient address")
        if int(amount_atto) < 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} amount_atto cannot be negative")
        if kind != KIND_GRANT and int(amount_atto) > 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {kind} proposals must not request funds")
        if kind == KIND_GOVERNANCE and self._governance_field_of(_clip(body, BODY_CLIP)) not in GOVERNANCE_FIELDS:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} governance body must be FIELD:VALUE where FIELD is one of {', '.join(GOVERNANCE_FIELDS)}")
        index = int(self.proposal_count) + 1
        proposal_id = "p" + str(index)
        self.proposals[proposal_id] = Proposal(
            proposer=gl.message.sender_address,
            title=_clip(title, 200),
            body=_clip(body, BODY_CLIP),
            kind=kind,
            amount_atto=u256(amount_atto),
            recipient=_clip(recipient, 64),
            created_at=datetime.now(timezone.utc).isoformat(),
            cycle=u256(self.cycle),
            verdict=VERDICT_PENDING,
            has_violation=False,
            rationale="",
            confidence=u256(0),
            approvals=u256(0),
            rejections=u256(0),
            executed=False,
            delivery_verdict=DELIVERY_NONE,
            delivery_score=u256(0),
            delivery_payout=u256(0),
            delivery_rationale="",
            settled=False,
        )
        self.proposal_violations[proposal_id] = []
        self.proposal_approvers[proposal_id] = []
        self.proposal_rejecters[proposal_id] = []
        self.proposal_order.append(proposal_id)
        self.proposal_count = u256(index)
        self._log({"event": "proposal_submitted", "id": proposal_id, "kind": str(kind), "cycle": int(self.cycle)})
        return proposal_id

    @gl.public.write
    def assess_proposal(self, proposal_id: str) -> None:
        self._require_live()
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        if str(self.proposals[proposal_id].verdict) != VERDICT_PENDING:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} was already assessed")
        if len(self.charter_rules) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} charter rules missing, call bootstrap_rules() first")

        charter_text = str(self.charter)
        mission_text = str(self.mission)
        proposal_title = str(self.proposals[proposal_id].title)
        proposal_body = str(self.proposals[proposal_id].body)
        proposal_kind = str(self.proposals[proposal_id].kind)
        proposal_amount = int(self.proposals[proposal_id].amount_atto)
        rules_text = self._rules_as_text()
        ceiling = self._spend_ceiling_atto()
        treasury = int(self.treasury)
        urls = self._urls_as_list()

        def leader_fn():
            evidence = _collect_evidence(urls)
            prompt = self._assessment_prompt(
                charter_text, mission_text, rules_text, proposal_title, proposal_body,
                proposal_kind, proposal_amount, treasury, ceiling, evidence,
            )
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            payload = _parse_json_object(raw)
            verdict = _pick_str(payload, ("verdict", "decision", "result"), "").upper()
            if verdict not in (VERDICT_COMPLIANT, VERDICT_NON_COMPLIANT, VERDICT_UNDETERMINED):
                verdict = VERDICT_UNDETERMINED
            violations = _as_str_list(payload, ("violations", "violated_rules", "breaches"))
            confidence = _pick_int(payload, ("confidence", "certainty"), 50)
            return {
                "verdict": verdict,
                "has_violation": len(violations) > 0,
                "violations": violations[:5],
                "rationale": _clip(_pick_str(payload, ("rationale", "reasoning", "explanation")), RATIONALE_CLIP),
                "confidence": max(0, min(100, confidence)),
            }

        def validator_fn(leaders_res) -> bool:
            def compare(theirs, mine) -> bool:
                if str(theirs["verdict"]) != str(mine["verdict"]):
                    return False
                if bool(theirs["has_violation"]) != bool(mine["has_violation"]):
                    return False
                if str(theirs["verdict"]) == VERDICT_COMPLIANT and len(mine["violations"]) > 0:
                    return False
                return _buckets_within_tolerance(
                    _confidence_bucket(int(theirs["confidence"])),
                    _confidence_bucket(int(mine["confidence"])),
                    1,
                )

            return self._verify(leaders_res, leader_fn, compare)

        decision = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.proposals[proposal_id].verdict = str(decision["verdict"])
        self.proposals[proposal_id].has_violation = bool(decision["has_violation"])
        self.proposal_violations[proposal_id] = [str(item) for item in decision["violations"]]
        self.proposals[proposal_id].rationale = str(decision["rationale"])
        self.proposals[proposal_id].confidence = u256(int(decision["confidence"]))
        self._log({
            "event": "proposal_assessed",
            "id": proposal_id,
            "verdict": str(decision["verdict"]),
            "violations": len(decision["violations"]),
        })

    @gl.public.write
    def cast_vote(self, proposal_id: str, approve: bool) -> None:
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        voter = gl.message.sender_address
        if voter not in self.members:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} sender is not a member")
        if self._has_voted(proposal_id, voter):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} member already voted on {proposal_id}")
        verdict = str(self.proposals[proposal_id].verdict)
        if verdict == VERDICT_PENDING:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal must be assessed before voting")
        if verdict == VERDICT_NON_COMPLIANT:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} cannot vote on a non compliant proposal")
        if bool(approve):
            self.proposal_approvers[proposal_id].append(str(voter))
            self.proposals[proposal_id].approvals = u256(int(self.proposals[proposal_id].approvals) + 1)
        else:
            self.proposal_rejecters[proposal_id].append(str(voter))
            self.proposals[proposal_id].rejections = u256(int(self.proposals[proposal_id].rejections) + 1)
        # Stamped only for approving votes, and only the first time, so a
        # constitutional change cannot have its delay restarted by more votes.
        if bool(approve) and str(self.proposals[proposal_id].kind) in CONSTITUTIONAL_KINDS:
            self._stamp_ready(proposal_id)
        self._log({"event": "vote", "id": proposal_id, "approve": bool(approve)})

    @gl.public.write
    def execute_proposal(self, proposal_id: str) -> None:
        self._require_live()
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        if bool(self.proposals[proposal_id].executed):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} was already executed")
        if str(self.proposals[proposal_id].verdict) != VERDICT_COMPLIANT:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} is not compliant")
        if not self._quorum_met(proposal_id):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} did not reach quorum")

        kind = str(self.proposals[proposal_id].kind)
        if kind in CONSTITUTIONAL_KINDS:
            self._require_timelock(proposal_id)

        if kind == KIND_GOVERNANCE:
            self._apply_governance(proposal_id)
            return

        if kind == KIND_CHARTER_AMENDMENT:
            # An amendment that carries no charter text would replace the
            # constitution with an empty string, so it can never execute. The
            # autonomous ADAPT path creates exactly such a proposal on purpose.
            if _clip(str(self.proposals[proposal_id].body), BODY_CLIP) == "":
                raise gl.vm.UserError(f"{ERROR_EXPECTED} amendment {proposal_id} carries no charter text, a member must author it")
            self.charter_history.append(_clip(str(self.charter), CHARTER_CLIP))
            self.charter = _clip(str(self.proposals[proposal_id].body), CHARTER_CLIP)
            self.charter_version = u256(int(self.charter_version) + 1)
            while len(self.charter_rules) > 0:
                self.charter_rules.pop()
            self.proposals[proposal_id].executed = True
            self.executed_count = u256(int(self.executed_count) + 1)
            self._log({
                "event": "charter_amended",
                "id": proposal_id,
                "charter_version": int(self.charter_version),
            })
            return

        amount = int(self.proposals[proposal_id].amount_atto)
        ceiling = self._spend_ceiling_atto()
        if amount > ceiling:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} amount {amount} exceeds policy ceiling {ceiling}")
        if amount > int(self.treasury):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} treasury {int(self.treasury)} cannot cover {amount}")
        self._pay(str(self.proposals[proposal_id].recipient), amount, "grant:" + proposal_id, BUCKET_GRANT)
        self.proposals[proposal_id].executed = True
        self.executed_count = u256(int(self.executed_count) + 1)
        self._log({
            "event": "grant_executed",
            "id": proposal_id,
            "amount_atto": str(amount),
            "recipient": str(self.proposals[proposal_id].recipient),
        })

    # ------------------------------------------------------------------
    # delivery review and settlement
    # ------------------------------------------------------------------

    @gl.public.write
    def review_delivery(self, proposal_id: str, evidence_url: str) -> None:
        self._require_live()
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        if str(self.proposals[proposal_id].verdict) != VERDICT_COMPLIANT:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} is not compliant")
        if not bool(self.proposals[proposal_id].executed):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} is not funded yet")
        if str(self.proposals[proposal_id].delivery_verdict) != DELIVERY_NONE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} delivery for {proposal_id} was already reviewed")
        url = _clip(evidence_url, 512)
        if not url.startswith("https://"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} evidence_url must start with https://")

        request = str(self.proposals[proposal_id].body)
        criteria = str(self.proposals[proposal_id].title)
        budget = int(self.proposals[proposal_id].amount_atto)

        def leader_fn():
            retrieved = _fetch_source(url)
            prompt = f"""You are the independent reviewer of work delivered under an autonomous fideicommis.
The work was commissioned with this title:
--- COMMISSION ---
{_clip(criteria, 1200)}
and this scope, which is also the acceptance criteria:
--- SCOPE ---
{_clip(request, 3000)}
--- DELIVERED EVIDENCE (public source) ---
{_clip(retrieved, EVIDENCE_CLIP)}
The total budget allocated for this work is {budget} attoGEN.

Decide whether the evidence shows the commissioned work was actually completed to the stated criteria.
Judge only what the evidence supports. If the evidence is empty, unrelated, or inconclusive, return UNDETERMINED.

Return JSON only, with exactly these keys:
{{
  "verdict": "ACCEPTED" | "REJECTED" | "UNDETERMINED",
  "score": integer 0 to 100 measuring how completely the criteria were met,
  "rationale": "one short paragraph citing the specific evidence you relied on"
}}"""
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            payload = _parse_json_object(raw)
            verdict = _pick_str(payload, ("verdict", "decision", "result"), "").upper()
            if verdict not in (DELIVERY_ACCEPTED, DELIVERY_REJECTED):
                verdict = DELIVERY_UNDETERMINED
            score = max(0, min(100, _pick_int(payload, ("score", "rating", "points"), 0)))
            if verdict == DELIVERY_UNDETERMINED:
                score = 0
            return {
                "verdict": verdict,
                "score": score,
                "rationale": _clip(_pick_str(payload, ("rationale", "reasoning", "explanation")), RATIONALE_CLIP),
            }

        def validator_fn(leaders_res) -> bool:
            def compare(theirs, mine) -> bool:
                if str(theirs["verdict"]) != str(mine["verdict"]):
                    return False
                if str(theirs["verdict"]) == DELIVERY_UNDETERMINED:
                    return True
                if str(theirs["verdict"]) == DELIVERY_REJECTED and int(mine["score"]) >= ACCEPT_THRESHOLD:
                    return False
                if str(theirs["verdict"]) == DELIVERY_ACCEPTED and int(mine["score"]) < ACCEPT_THRESHOLD:
                    return False
                return _buckets_within_tolerance(
                    int(theirs["score"]) // 20,
                    int(mine["score"]) // 20,
                    1,
                )

            return self._verify(leaders_res, leader_fn, compare)

        decision = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        score = int(decision["score"])
        if str(decision["verdict"]) != DELIVERY_ACCEPTED or score < ACCEPT_THRESHOLD:
            payout = 0
        else:
            payout = (budget * score) // 100
        if payout > int(self.treasury):
            payout = 0
        self.proposals[proposal_id].delivery_verdict = str(decision["verdict"])
        self.proposals[proposal_id].delivery_score = u256(score)
        self.proposals[proposal_id].delivery_payout = u256(payout)
        self.proposals[proposal_id].delivery_rationale = str(decision["rationale"])
        self._log({
            "event": "delivery_reviewed",
            "id": proposal_id,
            "verdict": str(decision["verdict"]),
            "score": str(score),
            "payout_atto": str(payout),
        })

    @gl.public.write
    def settle_delivery(self, proposal_id: str) -> None:
        self._require_live()
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        if str(self.proposals[proposal_id].delivery_verdict) != DELIVERY_ACCEPTED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} delivery for {proposal_id} is not accepted")
        if bool(self.proposals[proposal_id].settled):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} proposal {proposal_id} was already settled")
        payout = int(self.proposals[proposal_id].delivery_payout)
        if payout > int(self.treasury):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} treasury cannot cover payout {payout}")
        if payout > 0:
            self._pay(str(self.proposals[proposal_id].recipient), payout, "settlement:" + proposal_id, BUCKET_SETTLE)
        self.proposals[proposal_id].settled = True
        self.settled_count = u256(int(self.settled_count) + 1)
        self._log({"event": "delivery_settled", "id": proposal_id, "payout_atto": str(payout)})

    # ------------------------------------------------------------------
    # the unstoppable loop
    # ------------------------------------------------------------------

    @gl.public.write
    def advance_cycle(self) -> None:
        now = int(datetime.now(timezone.utc).timestamp())
        if str(self.status) != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fideicommis is {str(self.status)}, not {STATUS_ACTIVE}")
        if now < int(self.next_tick_at):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} next tick at {int(self.next_tick_at)}, now {now}")

        mission_text = str(self.mission)
        charter_text = str(self.charter)
        cycle_number = int(self.cycle)
        treasury_now = int(self.treasury)
        rules_text = self._rules_as_text()
        runway = self._runway_cycles()
        ceiling = self._spend_ceiling_atto()
        dashboard = self._proposal_dashboard()
        recent = self._recent_log(3)
        urls = self._urls_as_list()

        def leader_fn():
            evidence = _collect_evidence(urls)
            prompt = f"""You are the autonomous executive of a permanently funded fideicommis.
Its mission must be pursued for as long as the treasury lasts. You choose exactly one action per cycle.

MISSION:
{mission_text}

CHARTER CONSTRAINTS (the fideicommis may only act within these):
{_clip(charter_text, 3000)}

MACHINE-READABLE CHARTER RULES:
{_clip(rules_text, 2000)}

CURRENT STATE:
cycle: {cycle_number}
runway_cycles_remaining: {runway}
treasury_atto: {treasury_now}
max_single_spend_atto: {ceiling}

OPEN PROPOSALS (summarised):
{_clip(dashboard, 2500)}

RECENT MISSION LOG:
{_clip(recent, 1500)}

EXTERNAL EVIDENCE (optional, may be empty):
{_clip(evidence, 2500)}

Choose exactly one action:
- "SETTLE": pay the remaining settlement of a grant whose delivered work was already reviewed and accepted. Use that proposal_id.
- "FUND": pay a grant proposal that is already marked compliant, not executed, and carries enough member approvals. Use that proposal_id.
- "ADAPT": the mission, the constraints, or the environment changed, so the charter should be amended. Write the full proposed replacement charter in "rationale".
- "HOLD": nothing deserves action right now. Prefer this over inventing work.
- "WIND_DOWN": the fideicommis can no longer make progress against its mission and should begin winding down. Only choose this when the evidence supports it.

Rules you must respect:
- Never choose SETTLE or FUND with a proposal_id whose listed state does not match.
- amount_atto must be 0 unless you are paying a grant, and must never exceed max_single_spend_atto.
- Do not repeat work that the log shows is already completed.

Return JSON only, with exactly these keys:
{{
  "action": "SETTLE" | "FUND" | "ADAPT" | "HOLD" | "WIND_DOWN",
  "proposal_id": "the id of the proposal you are acting on, or an empty string",
  "amount_atto": integer amount to move in attoGEN (0 when not paying),
  "confidence": integer 0 to 100,
  "rationale": "one short paragraph"
}}"""
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            payload = _parse_json_object(raw)
            action = _pick_str(payload, ("action", "decision", "choice"), "").upper()
            if action not in VALID_ACTIONS:
                action = ACTION_HOLD
            amount = _pick_int(payload, ("amount_atto", "amount", "value"), 0)
            if amount < 0:
                amount = 0
            if amount > ceiling:
                amount = ceiling
            return {
                "action": action,
                "proposal_id": _clip(_pick_str(payload, ("proposal_id", "proposal", "id")), 64),
                "amount_atto": amount,
                "confidence": max(0, min(100, _pick_int(payload, ("confidence", "certainty"), 50))),
                "rationale": _clip(_pick_str(payload, ("rationale", "reasoning", "explanation")), RATIONALE_CLIP),
            }

        def validator_fn(leaders_res) -> bool:
            def compare(theirs, mine) -> bool:
                if str(theirs["action"]) != str(mine["action"]):
                    return False
                if int(theirs["amount_atto"]) > ceiling:
                    return False
                if str(theirs["action"]) in PAYING_ACTIONS:
                    if int(theirs["amount_atto"]) <= 0:
                        return False
                    if int(mine["amount_atto"]) > 0 and int(theirs["amount_atto"]) > (int(mine["amount_atto"]) * 12) // 10:
                        return False
                return _buckets_within_tolerance(
                    _confidence_bucket(int(theirs["confidence"])),
                    _confidence_bucket(int(mine["confidence"])),
                    1,
                )

            return self._verify(leaders_res, leader_fn, compare)

        decision = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self._apply_action(decision, now)
        self._log({
            "event": "cycle",
            "cycle": int(self.cycle),
            "action": str(self.last_action),
            "amount_atto": str(int(decision["amount_atto"])),
            "runway": self._runway_cycles(),
        })

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------

    @gl.public.write
    def wind_down(self) -> None:
        # Deliberately still an operator power, and this is the argument for it.
        # Winding down can only start, and only the remainder goes to the operator
        # when the estate is empty. The operator cannot fund themselves from a
        # live trust: a grant still needs a member vote and stays under the
        # ceiling, and dissolving requires the treasury to already be at zero.
        self._require_operator()
        if str(self.status) != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only an active fideicommis can wind down")
        self.status = STATUS_WINDING_DOWN
        self._log({"event": "wind_down_requested"})

    @gl.public.write
    def dissolve(self) -> None:
        self._require_operator()
        if str(self.status) != STATUS_WINDING_DOWN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fideicommis must be winding down first")
        remainder = int(self.treasury)
        if remainder > 0:
            self._pay(str(self.operator), remainder, "dissolution", BUCKET_DISSOLUTION)
        self.status = STATUS_DISSOLVED
        self._log({"event": "dissolved", "remainder_atto": str(remainder)})

    @gl.public.write
    def upgrade(self, new_code: bytes) -> None:
        root = gl.storage.Root.get()
        code = root.code.get()
        code.truncate()
        code.extend(new_code)

    # ------------------------------------------------------------------
    # views
    # ------------------------------------------------------------------

    @gl.public.view
    def get_org_name(self) -> str:
        return str(self.org_name)

    @gl.public.view
    def get_mission(self) -> str:
        return str(self.mission)

    @gl.public.view
    def get_charter(self) -> str:
        return str(self.charter)

    @gl.public.view
    def get_charter_version(self) -> u256:
        return u256(self.charter_version)

    @gl.public.view
    def get_charter_history(self) -> str:
        entries = []
        for entry in self.charter_history:
            entries.append(str(entry))
        return json.dumps(entries)

    @gl.public.view
    def get_status(self) -> str:
        return str(self.status)

    @gl.public.view
    def get_treasury(self) -> u256:
        return u256(self.treasury)

    @gl.public.view
    def get_lifetime_flow(self) -> str:
        burn = int(self.lifetime_outflow) - int(self.lifetime_granted) - int(self.lifetime_settled) - int(self.lifetime_dissolved)
        conserved = (
            int(self.treasury)
            + int(self.lifetime_granted)
            + int(self.lifetime_settled)
            + int(self.lifetime_dissolved)
            + int(self.total_keeper_paid)
            + burn
        )
        return json.dumps({
            "inflow_atto": int(self.lifetime_inflow),
            "outflow_atto": int(self.lifetime_outflow),
            "keeper_paid_atto": int(self.total_keeper_paid),
            "granted_atto": int(self.lifetime_granted),
            "settled_atto": int(self.lifetime_settled),
            "dissolved_atto": int(self.lifetime_dissolved),
            "burned_atto": burn,
            "treasury_atto": int(self.treasury),
            # The identity a test can falsify: every attoGEN that entered is in
            # the treasury, or left as a grant, a settlement, a dissolution
            # remainder, a burn, or a keeper reward.
            "conserved_atto": conserved,
        }, sort_keys=True)

    @gl.public.view
    def get_cycle(self) -> u256:
        return u256(self.cycle)

    @gl.public.view
    def get_last_action(self) -> str:
        return str(self.last_action)

    @gl.public.view
    def get_runway_cycles(self) -> u256:
        return self._runway_cycles()

    @gl.public.view
    def get_next_tick_at(self) -> u64:
        return u64(self.next_tick_at)

    @gl.public.view
    def get_constitution(self) -> str:
        """
        The immutable rules about the rules, as data.

        Deliberately separate from get_constitutional_state, which reports numbers
        a vote can change. This returns only what cannot change, so a caller can
        assert on it and be sure nothing has moved underneath the check.
        """
        return str(self.CONSTITUTION)

    @gl.public.view
    def get_constitutional_state(self) -> str:
        """
        The numbers that a vote may change but never past a hard limit, plus the
        delay any constitutional change has to sit through once approved.
        """
        return json.dumps({
            "quorum_bps": int(self.quorum_bps),
            "spend_ceiling_bps": int(self.spend_ceiling_bps),
            "min_quorum_bps": MIN_QUORUM_BPS,
            "max_spend_ceiling_bps": MAX_SPEND_CEILING_BPS,
            "amendment_delay": int(self.amendment_delay),
            "charter_version": int(self.charter_version),
            "total_shares": int(self.total_shares),
        }, sort_keys=True)

    @gl.public.view
    def get_policy(self) -> str:
        return json.dumps({
            "burn_per_cycle": int(self.burn_per_cycle),
            "keeper_reward": int(self.keeper_reward),
            "tick_interval": int(self.tick_interval),
            "quorum_bps": int(self.quorum_bps),
            "spend_ceiling_bps": int(self.spend_ceiling_bps),
            "spend_ceiling_atto": int(self._spend_ceiling_atto()),
        }, sort_keys=True)

    @gl.public.view
    def get_charter_rules(self) -> str:
        rules = []
        for rule in self.charter_rules:
            rules.append({"id": str(rule.id), "text": str(rule.text)})
        return json.dumps(rules)

    @gl.public.view
    def get_members(self) -> str:
        members = []
        for member in self.members:
            members.append({
                "address": str(member),
                "shares": int(self.member_shares.get(member, u256(0))),
            })
        return json.dumps(members)

    @gl.public.view
    def get_evidence_urls(self) -> str:
        urls = []
        for url in self.evidence_urls:
            urls.append(str(url))
        return json.dumps(urls)

    @gl.public.view
    def get_proposal(self, proposal_id: str) -> str:
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        return self._proposal_json(proposal_id)

    @gl.public.view
    def get_proposal_audit(self, proposal_id: str) -> str:
        """The model's own reasoning, for anyone auditing a settled decision.

        Kept out of _proposal_json on purpose: that feeds the advance_cycle prompt
        and is bounded, whereas this is a read on demand.
        """
        if proposal_id not in self.proposals:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown proposal {proposal_id}")
        proposal = self.proposals[proposal_id]
        violations = []
        for item in self.proposal_violations[proposal_id]:
            violations.append(str(item))
        return json.dumps({
            "id": proposal_id,
            "kind": str(proposal.kind),
            "verdict": str(proposal.verdict),
            "has_violation": bool(proposal.has_violation),
            "violations": violations,
            "rationale": str(proposal.rationale),
            "confidence": int(proposal.confidence),
            "delivery_verdict": str(proposal.delivery_verdict),
            "delivery_score": int(proposal.delivery_score),
            "delivery_rationale": str(proposal.delivery_rationale),
            "body": str(proposal.body),
        }, sort_keys=True)

    @gl.public.view
    def get_proposal_count(self) -> u256:
        return u256(self.proposal_count)

    @gl.public.view
    def get_proposal_ids(self) -> str:
        ids = []
        for proposal_id in self.proposal_order:
            ids.append(str(proposal_id))
        return json.dumps(ids)

    @gl.public.view
    def get_mission_log(self, offset: int, limit: int) -> str:
        start = max(0, int(offset))
        size = min(int(limit), MAX_LOG)
        if size <= 0:
            return "[]"
        entries = []
        total = len(self.mission_log)
        index = start
        while index < total and len(entries) < size:
            entries.append(str(self.mission_log[index]))
            index = index + 1
        return json.dumps(entries)

    @gl.public.view
    def get_org_summary(self) -> str:
        return json.dumps({
            "name": str(self.org_name),
            "mission": str(self.mission),
            "status": str(self.status),
            "charter_version": int(self.charter_version),
            "charter_rule_count": len(self.charter_rules),
            "treasury_atto": int(self.treasury),
            "runway_cycles": int(self._runway_cycles()),
            "cycle": int(self.cycle),
            "tick_count": int(self.tick_count),
            "proposal_count": int(self.proposal_count),
            "executed_count": int(self.executed_count),
            "settled_count": int(self.settled_count),
            "keeper_count": int(self.keeper_count),
            "keeper_paid_atto": int(self.total_keeper_paid),
            "log_entries": len(self.mission_log),
            "log_truncated": bool(self.log_truncated),
            "last_action": str(self.last_action),
        }, sort_keys=True)

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    def _require_operator(self) -> None:
        sender = gl.message.sender_address
        if sender != self.operator and sender != self.founder:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} sender is not the operator or founder")

    def _require_live(self) -> None:
        if str(self.status) == STATUS_DISSOLVED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fideicommis is dissolved")
        if str(self.status) == STATUS_WINDING_DOWN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fideicommis is winding down")

    def _handle_leader_error(self, leaders_res, leader_fn) -> bool:
        leader_message = ""
        if hasattr(leaders_res, "message"):
            leader_message = str(leaders_res.message)
        try:
            leader_fn()
            return False
        except gl.vm.UserError as failure:
            validator_message = str(failure.message) if hasattr(failure, "message") else str(failure)
            if validator_message.startswith(ERROR_EXPECTED) or validator_message.startswith(ERROR_EXTERNAL):
                return validator_message == leader_message
            if validator_message.startswith(ERROR_TRANSIENT) and leader_message.startswith(ERROR_TRANSIENT):
                return True
            return False
        except Exception:
            return False

    def _verify(self, leaders_res, leader_fn, compare) -> bool:
        """Run the validator's own attempt and compare it with the leader's result.

        A validator that cannot produce its own answer never accepts: it returns
        False so the transaction rotates to a new leader instead of settling on
        an unverified leader output.
        """
        if not isinstance(leaders_res, gl.vm.Return):
            return self._handle_leader_error(leaders_res, leader_fn)
        try:
            mine = leader_fn()
        except Exception:
            return False
        return bool(compare(leaders_res.calldata, mine))

    def _governance_field_of(self, text: str) -> str:
        """The FIELD half of a 'FIELD:VALUE' governance body, or "" if malformed."""
        stripped = str(text).strip()
        parts = stripped.split(":")
        if len(parts) < 2:
            return ""
        return parts[0].strip()

    def _require_timelock(self, proposal_id: str) -> None:
        """
        Refuse a constitutional change until it has sat approved for the delay.

        The clock starts when the proposal reached quorum, which is stamped in
        cast_vote. Measuring from submission instead would let a proposal that sat
        unvoted for a month execute the instant it was approved, and measuring
        from execution would be no delay at all.
        """
        now = _now_unix()
        ready_at = int(self.op_ready_at.get(proposal_id, u64(0)))
        if ready_at == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {proposal_id} never reached quorum, so its delay has not started")
        if now < ready_at + int(self.amendment_delay):
            remaining = ready_at + int(self.amendment_delay) - now
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {proposal_id} is timelocked for {remaining}s more")

    def _stamp_ready(self, proposal_id: str) -> None:
        """
        Record when a proposal first reached quorum, once. Kept separate from
        _quorum_met because the timelock must not restart if more votes arrive.
        """
        if int(self.op_ready_at.get(proposal_id, u64(0))) != 0:
            return
        if self._quorum_met(proposal_id):
            self.op_ready_at[proposal_id] = u64(_now_unix())

    def _apply_governance(self, proposal_id: str) -> None:
        """
        Apply a governance change that the members voted for.

        The body is a small, strictly parsed instruction rather than prose, so
        nothing a model wrote can reach this. Every value is re-validated here and
        not trusted from the proposal: the vote authorises an intent, and the
        contract decides whether that intent is legal.
        """
        # MEMBER_SHARES carries its own separator inside the value, so the field
        # is taken off the front and everything after the first colon is the
        # value rather than assuming exactly two parts.
        text = str(self.proposals[proposal_id].body).strip()
        colon = text.find(":")
        if colon <= 0 or colon + 1 >= len(text):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} governance {proposal_id} must be 'FIELD:VALUE'")
        field = text[:colon].strip()
        value = text[colon + 1:].strip()

        if field == GOV_FIELD_QUORUM:
            quorum = _parse_int_text(value)
            if quorum < MIN_QUORUM_BPS or quorum > 10000:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} quorum must be within {MIN_QUORUM_BPS}..10000")
            previous = int(self.quorum_bps)
            self.quorum_bps = u256(quorum)
            self.proposals[proposal_id].executed = True
            self.executed_count = u256(int(self.executed_count) + 1)
            self._log({"event": "quorum_changed", "id": proposal_id, "from_bps": previous, "to_bps": quorum})
            return

        if field == GOV_FIELD_CEILING:
            ceiling = _parse_int_text(value)
            if ceiling <= 0 or ceiling > MAX_SPEND_CEILING_BPS:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} spend ceiling must be within 1..{MAX_SPEND_CEILING_BPS}")
            previous = int(self.spend_ceiling_bps)
            self.spend_ceiling_bps = u256(ceiling)
            self.proposals[proposal_id].executed = True
            self.executed_count = u256(int(self.executed_count) + 1)
            self._log({"event": "ceiling_changed", "id": proposal_id, "from_bps": previous, "to_bps": ceiling})
            return

        if field == GOV_FIELD_SHARES:
            # The address and the share count are separated by a second colon, so
            # this is split once from the right.
            sep = value.rfind(":")
            if sep <= 0 or sep + 1 >= len(value):
                raise gl.vm.UserError(f"{ERROR_EXPECTED} shares must be 'MEMBER:SHARES'")
            bits = [value[:sep].strip(), value[sep + 1:].strip()]
            if len(bits) != 2:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} shares must be 'MEMBER:SHARES'")
            account = _to_address(bits[0].strip())
            shares = _parse_int_text(bits[1].strip())
            if shares < 0 or shares > MAX_SHARES_PER_MEMBER:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} shares must be within 0..{MAX_SHARES_PER_MEMBER}")
            if account not in self.members:
                if shares == 0:
                    raise gl.vm.UserError(f"{ERROR_EXPECTED} {account} is not a member, so their shares are already 0")
                self.members.append(account)
            # Computed before anything is written, so a rejected change cannot
            # leave the member list already stripped.
            remaining = 0
            for entry in self.members:
                value = 0 if str(entry) == str(account) else int(self.member_shares.get(Address(str(entry)), u256(0)))
                remaining = remaining + value
            if remaining == 0:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} shares must not leave the fideicommis with no voting members")
            if shares == 0:
                self.member_shares.pop(account, default=None)
                self.members.remove(account)
            else:
                self.member_shares[account] = u256(shares)
            self.total_shares = u256(remaining)
            self.proposals[proposal_id].executed = True
            self.executed_count = u256(int(self.executed_count) + 1)
            self._log({"event": "shares_changed", "id": proposal_id, "member": str(account), "shares": str(shares)})
            return

        if field == GOV_FIELD_EVIDENCE:
            parsed = _parse_url_list(value)
            if len(parsed) == 0:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} at least one https evidence url is required")
            while len(self.evidence_urls) > 0:
                self.evidence_urls.pop()
            for url in parsed:
                self.evidence_urls.append(url)
            self.proposals[proposal_id].executed = True
            self.executed_count = u256(int(self.executed_count) + 1)
            self._log({"event": "evidence_updated", "id": proposal_id, "count": len(parsed)})
            return

        if field == GOV_FIELD_RULES:
            if value.strip().lower() != "clear":
                raise gl.vm.UserError(f"{ERROR_EXPECTED} rules governance only supports 'clear'")
            while len(self.charter_rules) > 0:
                self.charter_rules.pop()
            self.proposals[proposal_id].executed = True
            self.executed_count = u256(int(self.executed_count) + 1)
            self._log({"event": "rules_cleared", "id": proposal_id})
            return

        raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown governance field {field}")

    def _log(self, entry: dict) -> None:
        if len(self.mission_log) >= MAX_LOG:
            self.log_truncated = True
            return
        self.mission_log.append(_clip(json.dumps(entry, sort_keys=True), ENTRY_CLIP))

    def _spend_ceiling_atto(self) -> u256:
        return u256((int(self.treasury) * int(self.spend_ceiling_bps)) // 10000)

    def _runway_cycles(self) -> u256:
        burn = int(self.burn_per_cycle)
        if burn <= 0:
            return u256(0)
        return u256(int(self.treasury) // burn)

    def _urls_as_list(self) -> list:
        urls = []
        for url in self.evidence_urls:
            urls.append(str(url))
        return urls

    def _rules_as_text(self) -> str:
        lines = []
        for rule in self.charter_rules:
            lines.append("- " + str(rule.id) + ": " + str(rule.text))
        return "\n".join(lines)

    def _has_voted(self, proposal_id: str, voter: Address) -> bool:
        key = str(voter)
        for entry in self.proposal_approvers[proposal_id]:
            if str(entry) == key:
                return True
        for entry in self.proposal_rejecters[proposal_id]:
            if str(entry) == key:
                return True
        return False

    def _quorum_met(self, proposal_id: str) -> bool:
        if int(self.proposals[proposal_id].approvals) <= int(self.proposals[proposal_id].rejections):
            return False
        total = int(self.total_shares)
        if total <= 0:
            return False
        approved_shares = 0
        for entry in self.proposal_approvers[proposal_id]:
            approved_shares = approved_shares + int(self.member_shares.get(Address(str(entry)), u256(0)))
        return (approved_shares * 10000) // total >= int(self.quorum_bps)

    def _pay(self, recipient: str, amount: int, memo: str, bucket: str) -> None:
        """
        Move value out of the estate.

        Every attoGEN that leaves is counted in exactly one bucket so that
        inflow == treasury + granted + settled + keeper_paid + burned is a
        checkable identity rather than a claim. The bucket is an explicit
        argument rather than parsed out of the memo, so a new payout path has to
        declare where it belongs and cannot quietly go untracked.
        """
        # Validated before any value moves, so an unbucketed payout cannot debit
        # the treasury and then fail its way out of the identity.
        if bucket not in (BUCKET_GRANT, BUCKET_SETTLE, BUCKET_DISSOLUTION):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} payout {memo} has no conservation bucket")
        address = _to_address(recipient)
        self.treasury = u256(int(self.treasury) - amount)
        self.lifetime_outflow = u256(int(self.lifetime_outflow) + amount)
        if bucket == BUCKET_GRANT:
            self.lifetime_granted = u256(int(self.lifetime_granted) + amount)
        elif bucket == BUCKET_SETTLE:
            self.lifetime_settled = u256(int(self.lifetime_settled) + amount)
        else:
            self.lifetime_dissolved = u256(int(self.lifetime_dissolved) + amount)
        _ChainAccount(address).emit_transfer(value=u256(amount))
        self._log({
            "event": "payout",
            "to": str(address),
            "amount_atto": str(amount),
            "memo": memo,
            "bucket": bucket,
        })

    def _proposal_dashboard(self) -> str:
        rows = []
        total = len(self.proposal_order)
        start = max(0, total - MAX_PROPOSAL_SCAN)
        index = start
        while index < total:
            proposal_id = str(self.proposal_order[index])
            rows.append(self._proposal_json(proposal_id))
            index = index + 1
        if len(rows) == 0:
            return "(no proposals yet)"
        return "\n".join(rows)

    def _proposal_json(self, proposal_id: str) -> str:
        proposal = self.proposals[proposal_id]
        violations = []
        for item in self.proposal_violations[proposal_id]:
            violations.append(str(item))
        return json.dumps({
            "id": proposal_id,
            "kind": str(proposal.kind),
            "title": _clip(str(proposal.title), 120),
            "amount_atto": int(proposal.amount_atto),
            "recipient": str(proposal.recipient),
            "verdict": str(proposal.verdict),
            "approvals": int(proposal.approvals),
            "rejections": int(proposal.rejections),
            "executed": bool(proposal.executed),
            "delivery_verdict": str(proposal.delivery_verdict),
            "delivery_score": int(proposal.delivery_score),
            "delivery_payout": int(proposal.delivery_payout),
            "settled": bool(proposal.settled),
            "violations": violations,
            # Bounded on purpose: this feeds the advance_cycle prompt, and a
            # charter amendment body is the one field that decides what the
            # constitution becomes. An auditor reads it via get_proposal_audit.
            "body_len": len(_clip(str(proposal.body), BODY_CLIP)),
        }, sort_keys=True)

    def _recent_log(self, count: int) -> str:
        total = len(self.mission_log)
        if total == 0:
            return "(empty log)"
        start = max(0, total - count)
        lines = []
        index = start
        while index < total:
            lines.append(str(self.mission_log[index]))
            index = index + 1
        return "\n".join(lines)

    def _assessment_prompt(self, charter_text, mission_text, rules_text, title, body, kind, amount, treasury, ceiling, evidence) -> str:
        share_bps = 0
        if treasury > 0:
            share_bps = (amount * 10000) // treasury
        procedure = ""
        if kind == KIND_CHARTER_AMENDMENT:
            procedure = """
THIS PROPOSAL REWRITES THE CHARTER ITSELF.
Assess it against the charter currently in force, not against the charter it proposes.
A rule such as "changing any of these rules requires the same approval process as an
ordinary grant" constrains the PROCESS, not the substance: it means an amendment is
judged by this assessment, then reaches the same quorum, and is then executed the same
way an ordinary grant is. It does not mean the amendment must itself satisfy the
substantive requirements that apply to grants. In particular, an amendment does not
have to name a public URL, does not have to fit the per grant ceiling, and does not
have to be work anyone would be paid to deliver. What it must satisfy is any rule that
constrains how the rules may be changed.
"""
        return f"""You are the compliance judge of an autonomous fideicommis.
Several validators reach this conclusion independently, so decide from the charter itself, not from style or tone.
{procedure}
MISSION:
{mission_text}

CHARTER:
{_clip(charter_text, 6000)}

MACHINE-READABLE CHARTER RULES:
{_clip(rules_text, 2500)}

PROPOSAL UNDER REVIEW
kind: {kind}
title: {title}
body:
{_clip(body, 3000)}

TREASURY FACTS. Use these instead of guessing, because a rule expressed as a
share of the treasury cannot be judged without the balance:
current treasury: {treasury} attoGEN
this request: {amount} attoGEN
this request as a share of the treasury: {share_bps} basis points, that is {share_bps // 100} percent
hard ceiling enforced on-chain for a single action: {ceiling} attoGEN
A request at or below the ceiling still has to satisfy every charter rule.

EXTERNAL EVIDENCE (optional, may be empty):
{_clip(evidence, 2000)}

Decide exactly one of:
- "COMPLIANT": the proposal stays within every charter rule and the budget policy.
- "NON_COMPLIANT": at least one charter rule or the budget policy is clearly broken. List them.
- "UNDETERMINED": the charter or the proposal is too vague to judge honestly.

Return JSON only, with exactly these keys:
{{
  "verdict": "COMPLIANT" | "NON_COMPLIANT" | "UNDETERMINED",
  "violations": ["short identifier of each broken rule, empty list when compliant"],
  "rationale": "one short paragraph citing the specific rule identifiers involved",
  "confidence": integer 0 to 100
}}"""

    def _derive_rules(self, charter_text: str, mission_text: str) -> dict:
        def leader_fn():
            prompt = f"""You are compiling a machine-checkable rulebook for an autonomous fideicommis.
Its mission is:
{mission_text}

Its charter is:
{_clip(charter_text, 6000)}

Extract the charter's binding obligations as a numbered rulebook. Each rule must be a single,
self-contained, checkable statement of what the fideicommis may or may not do, phrased so that a
proposal can be tested against it. Ignore descriptive or aspirational sentences that create no
obligation. Produce between 3 and {MAX_RULES} rules.

Return JSON only:
{{
  "rules": [
    {{"id": "R1", "text": "one binding rule", "mandatory": true}},
    ...
  ]
}}"""
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            payload = _parse_json_object(raw)
            collected = payload.get("rules", [])
            if not isinstance(collected, list):
                raise gl.vm.UserError(f"{ERROR_LLM} rules field is not a list")
            rules = []
            mandatory_count = 0
            position = 1
            for entry in collected:
                if position > MAX_RULES:
                    break
                if not isinstance(entry, dict):
                    continue
                text = _clip(_pick_str(entry, ("text", "rule", "statement"), ""), 300)
                if text == "":
                    continue
                mandatory = True
                for flag in ("mandatory", "required", "binding"):
                    if flag in entry and entry[flag] is not None:
                        mandatory = bool(entry[flag])
                        break
                if mandatory:
                    mandatory_count = mandatory_count + 1
                rules.append({"id": "R" + str(position), "text": text})
                position = position + 1
            if len(rules) < 3:
                raise gl.vm.UserError(f"{ERROR_LLM} only {len(rules)} rules extracted, at least 3 required")
            return {"rules": rules, "rule_count": len(rules), "mandatory_count": mandatory_count}

        def validator_fn(leaders_res) -> bool:
            def compare(theirs, mine) -> bool:
                if int(theirs["rule_count"]) < 3 or int(mine["rule_count"]) < 3:
                    return False
                if int(theirs["mandatory_count"]) < 1 or int(mine["mandatory_count"]) < 1:
                    return False
                return abs(int(theirs["rule_count"]) - int(mine["rule_count"])) <= 1

            return self._verify(leaders_res, leader_fn, compare)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _apply_action(self, decision: dict, now: int) -> None:
        requested = str(decision["action"])
        proposal_id = str(decision["proposal_id"])
        amount = int(decision["amount_atto"])
        keeper = gl.message.sender_address
        applied = requested
        detail = str(decision["rationale"])
        wind_down_requested = False

        if requested == ACTION_FUND:
            if not self._action_fund(proposal_id, amount):
                applied = ACTION_HOLD
                detail = _clip("FUND degraded to HOLD: " + detail, RATIONALE_CLIP)
        elif requested == ACTION_SETTLE:
            if not self._action_settle(proposal_id, amount):
                applied = ACTION_HOLD
                detail = _clip("SETTLE degraded to HOLD: " + detail, RATIONALE_CLIP)
        elif requested == ACTION_ADAPT:
            applied = self._action_adapt(detail)
        elif requested == ACTION_WIND_DOWN:
            wind_down_requested = True

        burn = int(self.burn_per_cycle)
        if burn > int(self.treasury):
            burn = int(self.treasury)
        reward = int(self.keeper_reward)
        if reward > int(self.treasury) - burn:
            reward = int(self.treasury) - burn
        if reward < 0:
            reward = 0

        if burn > 0:
            self.treasury = u256(int(self.treasury) - burn)
            self.lifetime_outflow = u256(int(self.lifetime_outflow) + burn)
        if reward > 0:
            _ChainAccount(keeper).emit_transfer(value=u256(reward))
            self.treasury = u256(int(self.treasury) - reward)
            self.total_keeper_paid = u256(int(self.total_keeper_paid) + reward)
            self.keeper_count = u256(int(self.keeper_count) + 1)

        self.cycle = u256(int(self.cycle) + 1)
        self.tick_count = u256(int(self.tick_count) + 1)
        self.last_tick_at = u64(now)
        self.next_tick_at = u64(now + int(self.tick_interval))
        self.last_action = applied
        self.last_rationale = detail

        # An empty treasury always wins over the chosen action. Winding down
        # exists to distribute a remainder to the operator, so a fideicommis
        # that has just run out of money has nothing to wind down. It sleeps
        # instead, which keeps the promise that any later funding revives it.
        if int(self.treasury) <= 0:
            if str(self.status) == STATUS_ACTIVE:
                self.status = STATUS_DORMANT
                self._log({"event": "dormant", "reason": "treasury exhausted", "cycle": int(self.cycle)})
        elif wind_down_requested:
            self.status = STATUS_WINDING_DOWN
            self._log({"event": "wind_down", "trigger": "autonomous", "cycle": int(self.cycle)})

    def _action_fund(self, proposal_id: str, amount: int) -> bool:
        if proposal_id == "" or proposal_id not in self.proposals:
            return False
        if str(self.proposals[proposal_id].kind) != KIND_GRANT:
            return False
        if str(self.proposals[proposal_id].verdict) != VERDICT_COMPLIANT:
            return False
        if bool(self.proposals[proposal_id].executed) or bool(self.proposals[proposal_id].settled):
            return False
        if not self._quorum_met(proposal_id):
            return False
        payable = int(self.proposals[proposal_id].amount_atto)
        if amount > 0 and amount < payable:
            payable = amount
        ceiling = int(self._spend_ceiling_atto())
        if payable > ceiling or payable > int(self.treasury):
            return False
        self._pay(str(self.proposals[proposal_id].recipient), payable, "autonomous_fund:" + proposal_id, BUCKET_GRANT)
        self.proposals[proposal_id].executed = True
        self.executed_count = u256(int(self.executed_count) + 1)
        return True

    def _action_settle(self, proposal_id: str, amount: int) -> bool:
        if proposal_id == "" or proposal_id not in self.proposals:
            return False
        if str(self.proposals[proposal_id].delivery_verdict) != DELIVERY_ACCEPTED:
            return False
        if not bool(self.proposals[proposal_id].executed) or bool(self.proposals[proposal_id].settled):
            return False
        payable = int(self.proposals[proposal_id].delivery_payout)
        if amount > 0 and amount < payable:
            payable = amount
        if payable > int(self.treasury):
            return False
        if payable > 0:
            self._pay(str(self.proposals[proposal_id].recipient), payable, "autonomous_settle:" + proposal_id, BUCKET_SETTLE)
        self.proposals[proposal_id].settled = True
        self.settled_count = u256(int(self.settled_count) + 1)
        return True

    def _action_adapt(self, proposed_charter: str) -> str:
        """
        Record the model's *suggestion* that the charter should change, and
        nothing else.

        The suggestion used to be written straight into the proposal body, which
        made an unvalidated piece of model prose the text that would later be
        voted on and become the constitution. Two validators could agree on
        ADAPT while describing completely different charters, and the text they
        never checked was the text that survived consensus. So the prose is
        logged as an advisory note and the proposal body starts empty: an
        autonomous cycle can raise the question, and only a member's own
        submission can answer it with actual charter text.
        """
        text = _clip(proposed_charter, BODY_CLIP)
        if len(text) < 40:
            return ACTION_HOLD
        index = int(self.proposal_count) + 1
        proposal_id = "a" + str(index)
        self.proposals[proposal_id] = Proposal(
            proposer=gl.message.sender_address,
            title="Autonomous charter adaptation (needs member-authored text)",
            body="",
            kind=KIND_CHARTER_AMENDMENT,
            amount_atto=u256(0),
            recipient="",
            created_at=datetime.now(timezone.utc).isoformat(),
            cycle=u256(self.cycle),
            verdict=VERDICT_PENDING,
            has_violation=False,
            rationale="",
            confidence=u256(0),
            approvals=u256(0),
            rejections=u256(0),
            executed=False,
            delivery_verdict=DELIVERY_NONE,
            delivery_score=u256(0),
            delivery_payout=u256(0),
            delivery_rationale="",
            settled=False,
        )
        self.proposal_violations[proposal_id] = []
        self.proposal_approvers[proposal_id] = []
        self.proposal_rejecters[proposal_id] = []
        self.proposal_order.append(proposal_id)
        self.proposal_count = u256(index)
        # Advisory only. This is where the model's suggestion is preserved for a
        # human to read, and it is deliberately not reachable from the
        # assessment prompt or from the charter that execute_proposal installs.
        self._log({
            "event": "adaptation_suggested",
            "id": proposal_id,
            "suggestion": text,
        })
        return ACTION_ADAPT
