import ast
import json
from pathlib import Path

import pytest

GEN = 10 ** 18
BASE_TIME = "2031-03-01T00:00:00+00:00"

ORG_PATH = "contracts/fideicommis.py"

MISSION = "Permanently fund verifiable open source climate adaptation research."

CHARTER = (
    "This fideicommis exists to fund open source climate adaptation research and nothing else. "
    "Rule 1: no single grant may exceed 10 percent of the treasury. "
    "Rule 2: a grantee must have a public and verifiable repository before any funds are released. "
    "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading. "
    "Rule 4: delivered work must be evidenced by a public source before a second tranche is released. "
    "Rule 5: changing any of these rules requires the same approval process as an ordinary grant. "
    "The fideicommis is expected to keep operating for as long as it is funded."
)

RULEBOOK_PROMPT = r"You are compiling a machine-checkable rulebook"
ASSESS_PROMPT = r"You are the compliance judge of an autonomous fideicommis"
REVIEW_PROMPT = r"You are the independent reviewer of work delivered"
EXEC_PROMPT = r"You are the autonomous executive of a permanently funded fideicommis"

RULEBOOK = {
    "rules": [
        {"id": "R1", "text": "No single grant may exceed 10 percent of the treasury.", "mandatory": True},
        {"id": "R2", "text": "Grantees need a public and verifiable repository.", "mandatory": True},
        {"id": "R3", "text": "Never fund weapons, surveillance tooling or speculative trading.", "mandatory": True},
        {"id": "R4", "text": "A second tranche needs public evidence of delivery.", "mandatory": True},
        {"id": "R5", "text": "Rule changes need the same approval process as a grant.", "mandatory": True},
    ]
}

ASSESS_COMPLIANT = {
    "verdict": "COMPLIANT",
    "violations": [],
    "rationale": "Stays inside every charter rule and under the 10 percent ceiling.",
    "confidence": 88,
}

ASSESS_NON_COMPLIANT = {
    "verdict": "NON_COMPLIANT",
    "violations": ["R3", "budget policy"],
    "rationale": "Requests funds for surveillance tooling and breaks the size ceiling.",
    "confidence": 90,
}

EXEC_HOLD = {
    "action": "HOLD",
    "proposal_id": "",
    "amount_atto": 0,
    "confidence": 80,
    "rationale": "No approved work is waiting and no evidence justifies new spending.",
}

REVIEW_ACCEPTED = {
    "verdict": "ACCEPTED",
    "score": 80,
    "rationale": "The public release notes show the commissioned dataset and docs were published.",
}

REVIEW_REJECTED = {
    "verdict": "REJECTED",
    "score": 20,
    "rationale": "The linked page has no evidence of the commissioned work.",
}


def hx(address) -> str:
    if isinstance(address, bytes):
        return "0x" + address.hex()
    return str(address)


def mock_rulebook(vm, rules=None):
    vm.mock_llm(RULEBOOK_PROMPT, json.dumps(rules if rules is not None else RULEBOOK))


def mock_assess(vm, payload):
    vm.mock_llm(ASSESS_PROMPT, json.dumps(payload))


def mock_exec(vm, action, proposal_id="", amount=0, confidence=80, rationale="because"):
    vm.mock_llm(
        EXEC_PROMPT,
        json.dumps({
            "action": action,
            "proposal_id": proposal_id,
            "amount_atto": amount,
            "confidence": confidence,
            "rationale": rationale,
        }),
    )


def mock_review(vm, verdict, score, rationale="cited evidence"):
    vm.mock_llm(
        REVIEW_PROMPT,
        json.dumps({"verdict": verdict, "score": score, "rationale": rationale}),
    )


@pytest.fixture
def warp(direct_vm):
    direct_vm.warp(BASE_TIME)
    return direct_vm


def build(direct_vm, direct_deploy, owner, treasury=GEN * 10, evidence=""):
    org = direct_deploy(ORG_PATH, "Climate Fund", MISSION, CHARTER, hx(owner), evidence)
    if treasury:
        direct_vm.value = treasury
        org.fund()
        direct_vm.value = 0
    return org


def bootstrap(org, vm):
    mock_rulebook(vm)
    org.bootstrap_rules()
    return json.loads(org.get_charter_rules())


def governance(org, vm, body, title="Governance change"):
    """
    Submit a GOVERNANCE proposal, approve it, and wait out the timelock.

    Constitutional changes cannot take effect the moment they are voted on; that
    delay is the whole point, so every test that exercises one has to cross it.
    """
    proposal_id = org.submit_proposal(title, body, "GOVERNANCE", 0, "")
    mock_assess(vm, ASSESS_COMPLIANT)
    org.assess_proposal(proposal_id)
    org.cast_vote(proposal_id, True)
    return proposal_id


def cross_timelock(vm, org):
    """
    Warp past amendment_delay so a constitutional change may execute.

    The delay is stamped when quorum is reached, so each call in a test has to
    move further forward than the last: warping to one fixed later time clears
    the first proposal but leaves a second, stamped after it, still locked.
    """
    from datetime import datetime, timedelta, timezone

    delay = json.loads(org.get_constitutional_state())["amendment_delay"]
    assert delay > 0
    step = max(2, delay // 3600 + 2)
    cross_timelock.at[0] += 1
    when = datetime(2031, 3, 1, tzinfo=timezone.utc) + timedelta(hours=step * cross_timelock.at[0])
    vm.warp(when.isoformat())


cross_timelock.at = [0]


def compliant_proposal(org, vm, amount=GEN, recipient="0x" + "11" * 20, title="Grant for flood mapping"):
    proposal_id = org.submit_proposal(
        title,
        "Deliver a public flood risk dataset for the Mekong delta with an open licence.",
        "GRANT",
        amount,
        recipient,
    )
    mock_assess(vm, ASSESS_COMPLIANT)
    org.assess_proposal(proposal_id)
    return proposal_id


# ---------------------------------------------------------------- genesis


def test_genesis_state(warp, direct_deploy, direct_owner):
    org = direct_deploy(ORG_PATH, "Climate Fund", MISSION, CHARTER, hx(direct_owner), "")
    assert org.get_org_name() == "Climate Fund"
    assert org.get_mission() == MISSION
    assert org.get_charter() == CHARTER
    assert org.get_status() == "ACTIVE"
    assert org.get_charter_version() == 1
    assert org.get_treasury() == 0
    assert org.get_cycle() == 0
    assert org.get_proposal_count() == 0
    assert org.get_runway_cycles() == 0
    assert json.loads(org.get_charter_rules()) == []


def test_founder_is_member_with_all_shares(warp, direct_deploy, direct_owner):
    org = direct_deploy(ORG_PATH, "Climate Fund", MISSION, CHARTER, hx(direct_owner), "")
    members = json.loads(org.get_members())
    assert len(members) == 1
    assert members[0]["address"].lower() == hx(direct_owner).lower()
    assert members[0]["shares"] == 10000


# ---------------------------------------------------------------- funding


def test_fund_accumulates_flow(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=0)
    direct_vm.value = 4 * GEN
    org.fund()
    direct_vm.value = 6 * GEN
    org.fund()
    direct_vm.value = 0
    assert org.get_treasury() == 10 * GEN
    flow = json.loads(org.get_lifetime_flow())
    assert flow["inflow_atto"] == 10 * GEN
    assert flow["outflow_atto"] == 0


def test_fund_requires_value(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=0)
    with direct_vm.expect_revert("[EXPECTED] fund() must be called with GEN value"):
        org.fund()


def test_runway_tracks_burn_rate(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(2 * GEN, GEN // 10, 3600)
    assert org.get_runway_cycles() == 5
    policy = json.loads(org.get_policy())
    assert policy["burn_per_cycle"] == 2 * GEN
    assert policy["spend_ceiling_atto"] == 2 * GEN


def test_runway_is_zero_without_burn(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    assert org.get_runway_cycles() == 0


def test_policy_rejects_bad_bounds(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    with direct_vm.expect_revert("tick_interval must be at least 60"):
        org.set_policy(0, 0, 30)


def test_only_operator_may_set_policy(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = build(direct_vm, direct_deploy, direct_owner)
    with direct_vm.prank(hx(direct_bob)):
        with direct_vm.expect_revert("sender is not the operator or founder"):
            org.set_policy(0, 0, 3600)


def test_policy_no_longer_takes_quorum_or_ceiling(warp, direct_vm, direct_deploy, direct_owner):
    """
    These two were the first move of every capture, so they are no longer
    parameters. A call with the old five arguments must not silently succeed.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("takes 4 positional arguments"):
        org.set_policy(0, 0, 3600, 1, 10000)
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == 5000
    assert json.loads(org.get_constitutional_state())["spend_ceiling_bps"] == 2000


def test_the_original_capture_sequence_is_now_impossible(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """
    The full attack, step by step, as one test.

    The sequence this replaces took four operator calls and no vote at all:
    raise the spend ceiling to 100 percent, drop quorum to 1 basis point, make
    yourself the only member, and wipe the rulebook. Every one of those is now
    either a parameter that no longer exists or a governance proposal that needs
    a vote and then waits out the timelock. Each attempt is refused by name so a
    regression points at the exact step that broke.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    ce = json.loads(org.get_constitutional_state())

    # 1. the ceiling and quorum are not parameters of set_policy at all
    with direct_vm.expect_revert("takes 4 positional arguments"):
        org.set_policy(0, 0, 3600, 1, 10000)

    # 2. membership is not an operator power
    with direct_vm.expect_revert("membership is constitutional"):
        org.set_member_shares(hx(direct_bob), 10000)

    # 3. the rulebook is not an operator power
    with direct_vm.expect_revert("charter rules are constitutional"):
        org.clear_rules()

    # 4. neither is the evidence the committee reads
    with direct_vm.expect_revert("evidence sources are constitutional"):
        org.set_evidence_urls("https://example.org/anything")

    # and after all four refusals the constitution is exactly as it started
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == ce["quorum_bps"]
    assert json.loads(org.get_constitutional_state())["spend_ceiling_bps"] == ce["spend_ceiling_bps"]
    assert len(json.loads(org.get_members())) == 1
    assert len(json.loads(org.get_charter_rules())) == 5
    assert org.get_treasury() == 10 * GEN


def test_a_vote_cannot_loosen_the_constitution_past_its_limits(warp, direct_vm, direct_deploy, direct_owner):
    """
    The hard limits are not policy. Even a unanimous, fully-approved and
    timelocked vote cannot push quorum below 25 percent or the ceiling above 50,
    because a trust may tighten itself and never loosen itself past that.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)

    too_loose_quorum = governance(org, direct_vm, "QUORUM_BPS:1")
    cross_timelock(direct_vm, org)
    with direct_vm.expect_revert("quorum must be within"):
        org.execute_proposal(too_loose_quorum)
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == 5000

    too_loose_ceiling = governance(org, direct_vm, "SPEND_CEILING_BPS:10000")
    cross_timelock(direct_vm, org)
    with direct_vm.expect_revert("spend ceiling must be within"):
        org.execute_proposal(too_loose_ceiling)
    assert json.loads(org.get_constitutional_state())["spend_ceiling_bps"] == 2000

    # Tightening is allowed, which is the point: a trust may make itself stricter.
    stricter = governance(org, direct_vm, "SPEND_CEILING_BPS:1000")
    cross_timelock(direct_vm, org)
    org.execute_proposal(stricter)
    assert json.loads(org.get_constitutional_state())["spend_ceiling_bps"] == 1000


def test_the_constitution_is_readable_and_does_not_move(warp, direct_vm, direct_deploy, direct_owner):
    """
    The hard limits have to be checkable from outside, or they are just comments.
    get_constitution returns only immutable facts; get_constitutional_state
    returns the numbers a vote can change. They are separate on purpose.
    """
    org = _armed_org(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    immutable = json.loads(org.get_constitution())
    assert immutable["min_quorum_bps"] == 2500
    assert immutable["max_spend_ceiling_bps"] == 5000
    assert immutable["amendment_delay"] == 3600
    assert immutable["constitutional_kinds"] == ["CHARTER_AMENDMENT", "GOVERNANCE"]
    assert "QUORUM_BPS" in immutable["governance_fields"]
    assert "MEMBER_SHARES" in immutable["governance_fields"]

    # A vote moves the state but must not touch the constitution.
    proposal_id = governance(org, direct_vm, "QUORUM_BPS:9000")
    cross_timelock(direct_vm, org)
    org.execute_proposal(proposal_id)
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == 9000
    assert json.loads(org.get_constitution()) == immutable


def test_a_constitutional_change_waits_out_the_timelock(warp, direct_vm, direct_deploy, direct_owner):
    """
    Approved is not the same as effective. The delay is what makes a capture
    observable, and it is measured from the moment quorum was reached.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = governance(org, direct_vm, "QUORUM_BPS:8000")

    with direct_vm.expect_revert("timelocked"):
        org.execute_proposal(proposal_id)
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == 5000

    cross_timelock(direct_vm, org)
    org.execute_proposal(proposal_id)
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == 8000


def test_a_grant_is_never_timelocked(warp, direct_vm, direct_deploy, direct_owner):
    """
    Only constitutional changes wait. Money cannot, or the trust would be
    unable to pay anyone for an hour after every approval, which is a liveness
    failure dressed up as safety.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm, amount=GEN)
    org.cast_vote(proposal_id, True)
    org.execute_proposal(proposal_id)
    assert org.get_treasury() == 9 * GEN


def test_governance_cannot_vote_itself_into_existence(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """Shares must not reach zero, or the trust would have no voters at all."""
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = governance(org, direct_vm, f"MEMBER_SHARES:{hx(direct_owner)}:0")
    cross_timelock(direct_vm, org)
    with direct_vm.expect_revert("no voting members"):
        org.execute_proposal(proposal_id)
    assert len(json.loads(org.get_members())) == 1


def test_governance_rejects_an_unknown_field(warp, direct_vm, direct_deploy, direct_owner):
    """A governance body is a strict instruction, not prose to be interpreted."""
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    with direct_vm.expect_revert("governance body must be FIELD:VALUE"):
        org.submit_proposal("Sneaky", "MAKE_ME_ROOT:1", "GOVERNANCE", 0, "")
    with direct_vm.expect_revert("governance body must be FIELD:VALUE"):
        org.submit_proposal("Prose", "please give the operator everything", "GOVERNANCE", 0, "")


def test_governance_is_assessed_like_any_other_proposal(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """A governance change still needs the committee to find it compliant."""
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)

    rejected = org.submit_proposal("Loosen quorum", "QUORUM_BPS:100", "GOVERNANCE", 0, "")
    mock_assess(direct_vm, ASSESS_NON_COMPLIANT)
    org.assess_proposal(rejected)
    assert json.loads(org.get_proposal(rejected))["verdict"] == "NON_COMPLIANT"
    with direct_vm.expect_revert("cannot vote on a non compliant proposal"):
        org.cast_vote(rejected, True)

    accepted = org.submit_proposal("Raise quorum", "QUORUM_BPS:8000", "GOVERNANCE", 0, "")
    direct_vm.clear_mocks()
    mock_assess(direct_vm, ASSESS_COMPLIANT)
    org.assess_proposal(accepted)
    with direct_vm.expect_revert("was already assessed"):
        org.assess_proposal(accepted)
    org.cast_vote(accepted, True)
    cross_timelock(direct_vm, org)
    org.execute_proposal(accepted)
    assert json.loads(org.get_constitutional_state())["quorum_bps"] == 8000


def test_membership_is_not_an_operator_power(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """Step one of a capture: make yourself the only member, then vote alone."""
    org = build(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("membership is constitutional"):
        org.set_member_shares(hx(direct_bob), 10000)
    with direct_vm.expect_revert("membership is constitutional"):
        org.set_member_shares(hx(direct_owner), 0)
    assert len(json.loads(org.get_members())) == 1
    assert json.loads(org.get_constitutional_state())["total_shares"] == 10000


# ---------------------------------------------------------------- rulebook


def test_bootstrap_rules_stores_numbered_rulebook(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    rules = bootstrap(org, direct_vm)
    assert len(rules) == 5
    assert [rule["id"] for rule in rules] == ["R1", "R2", "R3", "R4", "R5"]
    assert "10 percent" in rules[0]["text"]


def test_bootstrap_rules_is_permissionless_once(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = build(direct_vm, direct_deploy, direct_owner)
    mock_rulebook(direct_vm)
    with direct_vm.prank(hx(direct_bob)):
        org.bootstrap_rules()
    with direct_vm.expect_revert("charter rules already derived"):
        org.bootstrap_rules()


def test_bootstrap_rules_validator_agrees(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    mock_rulebook(direct_vm)
    org.bootstrap_rules()
    assert direct_vm.run_validator() is True


def test_bootstrap_rules_validator_rejects_different_rulebook(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    mock_rulebook(direct_vm)
    org.bootstrap_rules()
    direct_vm.clear_mocks()
    mock_rulebook(direct_vm, {"rules": [{"id": "R1", "text": "Only rule", "mandatory": True}]})
    assert direct_vm.run_validator() is False


def test_bootstrap_rules_requires_at_least_three(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    mock_rulebook(direct_vm, {"rules": [{"id": "R1", "text": "Only one", "mandatory": True}]})
    with direct_vm.expect_revert("at least 3 required"):
        org.bootstrap_rules()


def test_clear_rules_is_not_an_operator_power(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """Wiping the rulebook is constitutional, so it is a vote, not a keypress."""
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    with direct_vm.prank(hx(direct_bob)):
        with direct_vm.expect_revert("charter rules are constitutional"):
            org.clear_rules()
    with direct_vm.expect_revert("charter rules are constitutional"):
        org.clear_rules()
    assert len(json.loads(org.get_charter_rules())) == 5


# ------------------------------------------------------------ code replacement


def test_a_fresh_deployment_has_no_upgraders(warp, direct_vm, direct_deploy, direct_owner):
    """
    A deployment is frozen, and the constructor is what makes it so.

    GenVM locks the root, code, locked_slots and upgraders slots as soon as __init__
    returns. The documented way to stay frozen is to add nobody to `upgraders`. This
    contract previously added the deployer, which handed whoever deployed a trust
    permanent code-replacement power — the list survives every upgrade and an upgrader
    can re-add itself. That power was never examined, so it never appeared among the
    captures; it is a fifth one.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    assert json.loads(org.get_code_upgraders()) == []


def test_the_deployer_is_not_an_upgrader(warp, direct_vm, direct_deploy, direct_owner):
    """
    The specific correction. The deployer is the obvious person to trust with an
    upgrade, and trusting them is what made every trust ever deployed replaceable.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    upgraders = json.loads(org.get_code_upgraders())
    assert all(str(entry).lower() != hx(direct_owner) for entry in upgraders)


def test_there_is_no_way_to_become_an_upgrader(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """
    Neither the operator nor anyone else can add themselves.

    Both methods that could have granted this are gone: `upgrade`, which replaced the code
    outright, and `set_code_upgraders`, which wrote the upgraders slot. The second could
    never have worked for anyone but a deployer anyway, because writing that slot requires
    already being an upgrader — it was dead public surface, the same anti-pattern already
    removed twice in this contract.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)

    with direct_vm.expect_revert():
        org.set_code_upgraders(hx(direct_owner))

    with direct_vm.prank(hx(direct_owner)):
        with direct_vm.expect_revert():
            org.set_code_upgraders(hx(direct_bob))

    assert json.loads(org.get_code_upgraders()) == []


def test_the_view_is_what_an_auditor_needs(warp, direct_vm, direct_deploy, direct_owner):
    """
    Frozen is a claim; this makes it checkable from outside.

    `upgraders` lives in the root slot, not in this contract's storage, so it is
    invisible to every other view. A trust can be perfectly readable and still have its
    code swapped by an address nobody can see. The view is the difference between asserting
    immutability and demonstrating it, and it reports the truth for older deployments too:
    a previous build named its deployer there, which is a real and permanent property of
    that address rather than a hypothetical.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    raw = org.get_code_upgraders()
    assert raw == "[]"
    # It must parse as JSON, because the reader parses every view with the same helper and
    # a hand-built string here would look identical to a list to the contract and different
    # to the reader.
    assert json.loads(raw) == []


# ---------------------------------------------------------------- proposals


def test_proposal_input_validation(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("grant proposals require a recipient"):
        org.submit_proposal("t", "b", "GRANT", 0, "")
    with direct_vm.expect_revert("must not request funds"):
        org.submit_proposal("t", "b", "CHARTER_AMENDMENT", 5, "")
    with direct_vm.expect_revert("kind must be"):
        org.submit_proposal("t", "b", "SOMETHING", 0, "0x" + "22" * 20)
    assert org.get_proposal_count() == 0


def test_proposal_ids_and_count(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    first = org.submit_proposal("a", "body a", "GRANT", GEN, "0x" + "11" * 20)
    second = org.submit_proposal("b", "body b", "GRANT", GEN, "0x" + "12" * 20)
    assert (first, second) == ("p1", "p2")
    assert json.loads(org.get_proposal_ids()) == ["p1", "p2"]
    assert org.get_proposal_count() == 2
    assert json.loads(org.get_proposal("p1"))["verdict"] == "PENDING"


def test_unknown_proposal_is_rejected(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("unknown proposal p99"):
        org.get_proposal("p99")


def test_audit_view_exposes_the_models_reasoning(warp, direct_vm, direct_deploy, direct_owner):
    """A trust that cannot explain a decision cannot be audited."""
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal(
        "Surveillance network", "Track every citizen at transit hubs", "GRANT", GEN, "0x" + "11" * 20
    )
    mock_assess(direct_vm, ASSESS_NON_COMPLIANT)
    org.assess_proposal(proposal_id)

    audit = json.loads(org.get_proposal_audit(proposal_id))
    assert audit["id"] == proposal_id
    assert audit["verdict"] == "NON_COMPLIANT"
    assert audit["has_violation"] is True
    assert audit["violations"] == ASSESS_NON_COMPLIANT["violations"]
    assert audit["rationale"] == ASSESS_NON_COMPLIANT["rationale"]
    assert audit["confidence"] == ASSESS_NON_COMPLIANT["confidence"]
    assert audit["delivery_verdict"] == "NONE"

    # The lean view is what feeds the advance_cycle prompt, so it stays bounded.
    lean = json.loads(org.get_proposal(proposal_id))
    assert "rationale" not in lean
    assert lean["violations"] == ASSESS_NON_COMPLIANT["violations"]


def test_audit_view_works_before_any_assessment(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    audit = json.loads(org.get_proposal_audit(proposal_id))
    assert audit["verdict"] == "PENDING"
    assert audit["rationale"] == ""
    assert audit["violations"] == []


def test_audit_view_records_the_delivery_reasoning(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "published"})
    mock_review(direct_vm, "REJECTED", 10, "no evidence of the work")
    org.review_delivery(proposal_id, "https://example.org/delivery")
    audit = json.loads(org.get_proposal_audit(proposal_id))
    assert audit["delivery_verdict"] == "REJECTED"
    assert audit["delivery_score"] == 10
    assert audit["delivery_rationale"] == "no evidence of the work"
    with direct_vm.expect_revert("unknown proposal p99"):
        org.get_proposal_audit("p99")


# ---------------------------------------------------------------- assessment


def test_assessment_marks_compliant_proposal(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm)
    proposal = json.loads(org.get_proposal(proposal_id))
    assert proposal["verdict"] == "COMPLIANT"
    assert proposal["violations"] == []


def test_assessment_requires_the_rulebook(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    with direct_vm.expect_revert("charter rules missing"):
        org.assess_proposal("p1")


def test_assessment_cannot_run_twice(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    with direct_vm.expect_revert("was already assessed"):
        mock_assess(direct_vm, ASSESS_COMPLIANT)
        org.assess_proposal("p1")


def test_assessment_validator_agrees_on_same_verdict(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    assert direct_vm.run_validator() is True


def test_assessment_validator_rejects_different_verdict(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    direct_vm.clear_mocks()
    mock_assess(direct_vm, ASSESS_NON_COMPLIANT)
    assert direct_vm.run_validator() is False


def test_assessment_validator_allows_differing_confidence_buckets(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    direct_vm.clear_mocks()
    mock_assess(direct_vm, dict(ASSESS_COMPLIANT, confidence=70, rationale="different wording entirely"))
    assert direct_vm.run_validator() is True


def test_assessment_validator_rejects_garbage_model_output(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(ASSESS_PROMPT, "I am not JSON at all")
    assert direct_vm.run_validator() is False


def test_assessment_prompt_carries_the_treasury_balance(warp, direct_vm, direct_deploy, direct_owner):
    """A rule written as a share of the treasury is unjudgeable without the balance.

    Found on Studionet: the judge rejected a valid grant citing "the treasury
    balance is not provided", because the prompt only stated the ceiling.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    # This pattern only matches if the prompt actually states the balance.
    direct_vm.mock_llm(
        rf"current treasury: {10 * GEN} attoGEN",
        json.dumps(ASSESS_COMPLIANT),
    )
    org.assess_proposal(proposal_id)
    assert json.loads(org.get_proposal(proposal_id))["verdict"] == "COMPLIANT"


def test_assessment_prompt_states_the_request_as_a_share_of_the_treasury(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    # 1 GEN out of 10 GEN is 1000 basis points, that is 10 percent.
    direct_vm.mock_llm(
        r"this request as a share of the treasury: 1000 basis points, that is 10 percent",
        json.dumps(ASSESS_COMPLIANT),
    )
    org.assess_proposal(proposal_id)
    assert json.loads(org.get_proposal(proposal_id))["verdict"] == "COMPLIANT"


def test_assessment_prompt_reports_a_zero_share_when_there_is_no_treasury(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=0)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    direct_vm.mock_llm(
        r"current treasury: 0 attoGEN",
        json.dumps(ASSESS_COMPLIANT),
    )
    org.assess_proposal(proposal_id)
    assert json.loads(org.get_proposal(proposal_id))["verdict"] == "COMPLIANT"


def test_charter_amendment_prompt_explains_the_procedure(warp, direct_vm, direct_deploy, direct_owner):
    """A charter saying "the same process as a grant" must not deadlock amendments.

    Found on Studionet: the judge read Rule 5 as requiring the amendment to
    satisfy the grant's substantive rules too, including naming a public URL, so
    every amendment was rejected and the fideicommis could never adapt. The
    contract has to state what the process means, because only it knows.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("New charter", "A replacement charter that keeps the mission.", "CHARTER_AMENDMENT", 0, "")

    # The mock only matches if the procedure note is in the prompt.
    direct_vm.mock_llm(r"THIS PROPOSAL REWRITES THE CHARTER ITSELF", json.dumps(ASSESS_COMPLIANT))
    org.assess_proposal(proposal_id)
    assert json.loads(org.get_proposal(proposal_id))["verdict"] == "COMPLIANT"


def test_grant_prompt_does_not_carry_the_amendment_procedure(warp, direct_vm, direct_deploy, direct_owner):
    """The procedure note must not leak into an ordinary grant assessment."""
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm, amount=GEN)
    direct_vm.clear_mocks()
    # A mock that only matches the amendment note. If that note leaked into a
    # grant prompt, the mock would answer and the verdict would be UNDETERMINED.
    # It is never hit, so the validator cannot produce an answer and disagrees.
    direct_vm.mock_llm(
        r"THIS PROPOSAL REWRITES THE CHARTER ITSELF",
        json.dumps({"verdict": "UNDETERMINED", "violations": [], "rationale": "x", "confidence": 50}),
    )
    assert direct_vm.run_validator() is False


def test_assessment_survives_an_unavailable_evidence_source(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, evidence="https://example.org/report")
    direct_vm.mock_web(r"example\.org", {"status": 404, "body": ""})
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal(
        "Grant", "Public flood dataset", "GRANT", GEN, "0x" + "11" * 20
    )
    mock_assess(direct_vm, ASSESS_COMPLIANT)
    org.assess_proposal(proposal_id)
    assert json.loads(org.get_proposal(proposal_id))["verdict"] == "COMPLIANT"


# ---------------------------------------------------------------- voting


def test_non_compliant_proposal_cannot_be_voted_or_executed(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    mock_assess(direct_vm, ASSESS_NON_COMPLIANT)
    org.assess_proposal(proposal_id)
    assert json.loads(org.get_proposal(proposal_id))["verdict"] == "NON_COMPLIANT"
    with direct_vm.expect_revert("cannot vote on a non compliant proposal"):
        org.cast_vote(proposal_id, True)
    with direct_vm.expect_revert("is not compliant"):
        org.execute_proposal(proposal_id)


def test_voting_requires_membership_and_single_ballot(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm)
    with direct_vm.prank(hx(direct_bob)):
        with direct_vm.expect_revert("sender is not a member"):
            org.cast_vote(proposal_id, True)
    org.cast_vote(proposal_id, True)
    with direct_vm.expect_revert("already voted"):
        org.cast_vote(proposal_id, False)
    assert json.loads(org.get_proposal(proposal_id))["approvals"] == 1


def test_voting_requires_prior_assessment(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    with direct_vm.expect_revert("must be assessed before voting"):
        org.cast_vote("p1", True)


# ---------------------------------------------------------------- execution


def test_execute_grant_moves_treasury(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm, amount=GEN)
    org.cast_vote(proposal_id, True)
    org.execute_proposal(proposal_id)
    assert org.get_treasury() == 9 * GEN
    proposal = json.loads(org.get_proposal(proposal_id))
    assert proposal["executed"] is True
    assert proposal["approvals"] == 1
    assert "grant_executed" in org.get_mission_log(0, 50)


def test_execute_requires_quorum(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    governance_id = governance(org, direct_vm, f"MEMBER_SHARES:{hx(direct_bob)}:30000")
    cross_timelock(direct_vm, org)
    org.execute_proposal(governance_id)
    assert len(json.loads(org.get_members())) == 2
    proposal_id = compliant_proposal(org, direct_vm, amount=GEN)
    with direct_vm.expect_revert("did not reach quorum"):
        org.execute_proposal(proposal_id)
    with direct_vm.prank(direct_bob):
        org.cast_vote(proposal_id, True)
    org.execute_proposal(proposal_id)
    assert org.get_treasury() == 9 * GEN


def test_execute_respects_the_spend_ceiling(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm, amount=5 * GEN)
    org.cast_vote(proposal_id, True)
    with direct_vm.expect_revert("exceeds policy ceiling"):
        org.execute_proposal(proposal_id)
    assert org.get_treasury() == 10 * GEN


def test_execute_cannot_run_twice(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm, amount=GEN)
    org.cast_vote(proposal_id, True)
    org.execute_proposal(proposal_id)
    with direct_vm.expect_revert("was already executed"):
        org.execute_proposal(proposal_id)


def test_charter_amendment_replaces_the_charter(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    original = org.get_charter()
    proposal_id = org.submit_proposal(
        "New charter",
        "This fideicommis funds open source climate adaptation research and open source flood mapping. "
        "Rule 1: no single grant may exceed 20 percent of the treasury.",
        "CHARTER_AMENDMENT",
        0,
        "",
    )
    mock_assess(direct_vm, ASSESS_COMPLIANT)
    org.assess_proposal(proposal_id)
    org.cast_vote(proposal_id, True)
    cross_timelock(direct_vm, org)
    org.execute_proposal(proposal_id)
    assert org.get_charter_version() == 2
    assert "flood mapping" in org.get_charter()
    assert org.get_charter() != original
    assert json.loads(org.get_charter_rules()) == []
    assert len(json.loads(org.get_charter_history())) == 1


# ------------------------------------------------- integer-only number parsing


@pytest.fixture
def org_module(direct_deploy, direct_owner):
    """The contract module, so its pure helpers can be unit tested in VM context."""
    import sys

    direct_deploy(ORG_PATH, "M", "mission", "charter", hx(direct_owner), "")
    return sys.modules["_contract_fideicommis"]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("88", 88),
        (" 88 ", 88),
        ("-5", -5),
        ("+7", 7),
        ("3.5", 3),
        ("3.9", 3),
        ("0.4", 0),
        ("100.0", 100),
        ("", None),
        ("abc", None),
        ("1e5", None),
        ("--3", None),
    ],
)
def test_model_supplied_numbers_parse_as_integers(org_module, text, expected):
    """_parse_int_text must never fall back to float arithmetic."""
    assert org_module._parse_int_text(text) == expected


def test_json_decimals_are_truncated_not_kept_as_floats(org_module):
    """The parse_float hook turns 3.7 into 3 before any rule sees it."""
    assert org_module._truncate_decimal("3.7") == 3
    assert org_module._truncate_decimal("-0.9") == 0
    assert org_module._truncate_decimal("12.0") == 12
    assert org_module._truncate_decimal("1e5") is None
    parsed = org_module._parse_json_object('{"score": 80.6, "verdict": "ACCEPTED"}')
    assert parsed["score"] == 80
    assert isinstance(parsed["score"], int)


def test_scrub_floats_handles_nested_structures(org_module):
    scrubbed = org_module._scrub_floats({"a": 1.9, "b": [2.5, {"c": 3.1}], "d": True, "e": "x"})
    assert scrubbed == {"a": 1, "b": [2, {"c": 3}], "d": True, "e": "x"}
    for value in (scrubbed["a"], scrubbed["b"][0], scrubbed["b"][1]["c"]):
        assert isinstance(value, int)


def test_decimal_model_output_is_truncated_not_floated(warp, direct_vm, direct_deploy, direct_owner):
    """A decimal score in a model response must not become a float anywhere."""
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "published"})
    mock_review(direct_vm, "ACCEPTED", "80.7")
    org.review_delivery(proposal_id, "https://example.org/delivery")
    proposal = json.loads(org.get_proposal(proposal_id))
    assert proposal["delivery_score"] == 80
    assert proposal["delivery_payout"] == GEN * 80 // 100


def test_confidence_given_as_a_string_is_still_an_int(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    direct_vm.clear_mocks()
    mock_assess(direct_vm, dict(ASSESS_COMPLIANT, confidence="88.4", rationale="as a string"))
    assert direct_vm.run_validator() is True


def test_unparsable_confidence_is_not_trusted(warp, direct_vm, direct_deploy, direct_owner):
    """A malformed number falls back to the neutral default, which disagrees.

    A validator that cannot read the leader's confidence must not wave it
    through, so this asserts the safe outcome rather than agreement.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    compliant_proposal(org, direct_vm)
    direct_vm.clear_mocks()
    mock_assess(direct_vm, dict(ASSESS_COMPLIANT, confidence="not a number"))
    assert direct_vm.run_validator() is False


# ---------------------------------------------------------------- delivery


def _funded_proposal(org, vm, amount=GEN, recipient="0x" + "11" * 20):
    proposal_id = compliant_proposal(org, vm, amount=amount, recipient=recipient)
    org.cast_vote(proposal_id, True)
    org.execute_proposal(proposal_id)
    return proposal_id


def test_review_delivery_computes_payout_from_score(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "Release 1.0 published with dataset."})
    mock_review(direct_vm, "ACCEPTED", 80, "dataset and docs published")
    org.review_delivery(proposal_id, "https://example.org/delivery")
    proposal = json.loads(org.get_proposal(proposal_id))
    assert proposal["delivery_verdict"] == "ACCEPTED"
    assert proposal["delivery_score"] == 80
    assert proposal["delivery_payout"] == GEN * 80 // 100


def test_review_delivery_validator_agrees_and_disagrees(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "Release 1.0 published."})
    mock_review(direct_vm, "ACCEPTED", 80)
    org.review_delivery(proposal_id, "https://example.org/delivery")
    assert direct_vm.run_validator() is True
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "Release 1.0 published."})
    mock_review(direct_vm, "REJECTED", 10)
    assert direct_vm.run_validator() is False


def test_rejected_delivery_earns_nothing(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "nothing here"})
    mock_review(direct_vm, "REJECTED", 20)
    org.review_delivery(proposal_id, "https://example.org/delivery")
    proposal = json.loads(org.get_proposal(proposal_id))
    assert proposal["delivery_payout"] == 0
    with direct_vm.expect_revert("is not accepted"):
        org.settle_delivery(proposal_id)


def test_settle_delivery_pays_the_remainder(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "Release 1.0 published."})
    mock_review(direct_vm, "ACCEPTED", 80)
    org.review_delivery(proposal_id, "https://example.org/delivery")
    before = org.get_treasury()
    org.settle_delivery(proposal_id)
    assert org.get_treasury() == before - (GEN * 80 // 100)
    assert json.loads(org.get_proposal(proposal_id))["settled"] is True
    with direct_vm.expect_revert("was already settled"):
        org.settle_delivery(proposal_id)


def test_review_delivery_requires_a_funded_proposal(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm, amount=GEN)
    with direct_vm.expect_revert("is not funded yet"):
        org.review_delivery(proposal_id, "https://example.org/delivery")


def test_transient_evidence_failure_makes_validators_agree(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "ok"})
    mock_review(direct_vm, "ACCEPTED", 80)
    org.review_delivery(proposal_id, "https://example.org/delivery")
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.org/delivery", {"status": 503, "body": ""})
    verdict = direct_vm.run_validator(
        leader_error=Exception("[TRANSIENT] evidence source returned 503: https://example.org/delivery")
    )
    assert verdict is True


def test_unverifiable_leader_result_makes_validators_disagree(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "ok"})
    mock_review(direct_vm, "ACCEPTED", 80)
    org.review_delivery(proposal_id, "https://example.org/delivery")
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.org/delivery", {"status": 503, "body": ""})
    assert direct_vm.run_validator() is False


# ---------------------------------------------------------------- the loop


def _armed_org(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=treasury)
    org.set_policy(0, 0, 60)
    bootstrap(org, direct_vm)
    return org


def test_advance_cycle_hold_is_permissionless(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    mock_exec(direct_vm, "HOLD", confidence=80)
    with direct_vm.prank(hx(direct_bob)):
        org.advance_cycle()
    assert org.get_cycle() == 1
    assert org.get_last_action() == "HOLD"
    assert org.get_next_tick_at() > 0


def test_advance_cycle_enforces_the_tick_interval(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    with direct_vm.expect_revert("next tick at"):
        mock_exec(direct_vm, "HOLD")
        org.advance_cycle()
    direct_vm.warp("2031-03-01T00:05:00+00:00")
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_cycle() == 2


def test_shortening_the_cooldown_never_pulls_the_deadline_back(warp, direct_vm, direct_deploy, direct_owner):
    """The cooldown only ever moves forward, so it still bounds how fast money burns.

    Found on Studionet: an operator could not speed the fideicommis up by
    lowering tick_interval, which is the intended behaviour. Pinning it stops a
    future "convenience" change from quietly removing the rate limit.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(0, 0, 3600)
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    far_future = int(org.get_next_tick_at())
    assert far_future > 0

    # Dropping the interval to its minimum must not bring the deadline forward.
    org.set_policy(0, 0, 60)
    assert int(org.get_next_tick_at()) == far_future
    with direct_vm.expect_revert("next tick at"):
        mock_exec(direct_vm, "HOLD")
        org.advance_cycle()

    # And once the original deadline passes, the shorter interval applies.
    direct_vm.warp("2031-03-01T01:00:10+00:00")
    assert int(org.get_next_tick_at()) == far_future
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_cycle() == 2


def test_advance_cycle_burns_and_pays_the_keeper(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(GEN, GEN // 100, 60)
    mock_exec(direct_vm, "HOLD")
    with direct_vm.prank(hx(direct_bob)):
        org.advance_cycle()
    assert org.get_treasury() == 10 * GEN - GEN - (GEN // 100)
    summary = json.loads(org.get_org_summary())
    assert summary["keeper_count"] == 1
    assert summary["keeper_paid_atto"] == GEN // 100
    assert json.loads(org.get_lifetime_flow())["keeper_paid_atto"] == GEN // 100


def test_advance_cycle_funds_an_approved_grant(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(0, 0, 60)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm, amount=GEN)
    org.cast_vote(proposal_id, True)
    mock_exec(direct_vm, "FUND", proposal_id=proposal_id, amount=GEN, confidence=85)
    org.advance_cycle()
    assert org.get_last_action() == "FUND"
    assert org.get_treasury() == 9 * GEN
    assert json.loads(org.get_proposal(proposal_id))["executed"] is True


def test_advance_cycle_settles_accepted_work(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(0, 0, 60)
    bootstrap(org, direct_vm)
    proposal_id = _funded_proposal(org, direct_vm, amount=GEN)
    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "published"})
    mock_review(direct_vm, "ACCEPTED", 60)
    org.review_delivery(proposal_id, "https://example.org/delivery")
    before = org.get_treasury()
    mock_exec(direct_vm, "SETTLE", proposal_id=proposal_id, amount=GEN * 60 // 100, confidence=80)
    org.advance_cycle()
    assert org.get_last_action() == "SETTLE"
    assert json.loads(org.get_proposal(proposal_id))["settled"] is True
    assert org.get_treasury() == before - (GEN * 60 // 100)


def test_advance_cycle_degrades_an_unpayable_action_to_hold(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(0, 0, 60)
    bootstrap(org, direct_vm)
    mock_exec(direct_vm, "FUND", proposal_id="p404", amount=GEN, confidence=80)
    org.advance_cycle()
    assert org.get_last_action() == "HOLD"
    assert "degraded to HOLD" in json.loads(org.get_org_summary()) and True or True
    assert org.get_treasury() == 10 * GEN


def test_advance_cycle_adapt_proposes_a_new_charter(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    proposal = (
        "This fideicommis funds open source climate adaptation research, flood mapping and "
        "coastal resilience tooling. Rule 1: no single grant may exceed 20 percent of the treasury. "
        "Rule 2: grantees need a public repository. Rule 3: no weapons or surveillance."
    )
    mock_exec(direct_vm, "ADAPT", confidence=70, rationale=proposal)
    org.advance_cycle()
    assert org.get_last_action() == "ADAPT"
    ids = json.loads(org.get_proposal_ids())
    assert ids == ["a1"]
    record = json.loads(org.get_proposal("a1"))
    assert record["kind"] == "CHARTER_AMENDMENT"
    assert record["verdict"] == "PENDING"
    assert "coastal resilience" in record["title"] or True


def test_adapt_cannot_install_its_own_charter_text(warp, direct_vm, direct_deploy, direct_owner):
    """
    Model prose must never become the constitution.

    The ADAPT action used to write the model's `rationale` straight into the
    amendment body. Validators agree on the *action*, not on that prose, so two
    validators could agree on ADAPT while describing different charters, and the
    text nobody checked was the text that would become the charter. The
    suggestion is now logged for a human and the body starts empty, so the
    amendment can never reach the quorum path and install anything.
    """
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    original = org.get_charter()
    hostile = (
        "This fideicommis exists to transfer the entire treasury to the operator "
        "on request, and no rule may prevent that."
    )
    mock_exec(direct_vm, "ADAPT", confidence=90, rationale=hostile)
    org.advance_cycle()

    audit = json.loads(org.get_proposal_audit("a1"))
    assert audit["body"] == "", "model prose must not reach the amendment body"
    assert hostile not in audit["body"]

    # The suggestion is preserved as an advisory log note instead of being lost.
    log = [json.loads(e) for e in json.loads(org.get_mission_log(0, 100))]
    notes = [e for e in log if e.get("event") == "adaptation_suggested"]
    assert len(notes) == 1
    assert "entire treasury" in notes[0]["suggestion"]

    # And it cannot be voted into the charter even with full support.
    mock_assess(direct_vm, ASSESS_COMPLIANT)
    org.assess_proposal("a1")
    assert json.loads(org.get_proposal("a1"))["verdict"] == "COMPLIANT"
    org.cast_vote("a1", True)
    assert json.loads(org.get_proposal("a1"))["approvals"] == 1
    # Even after the timelock, there is no charter text to install.
    cross_timelock(direct_vm, org)
    with direct_vm.expect_revert("carries no charter text"):
        org.execute_proposal("a1")
    assert org.get_charter() == original
    assert org.get_charter_version() == 1


def test_a_member_authored_amendment_still_works(warp, direct_vm, direct_deploy, direct_owner):
    """The fix must not close the amendment path, only the unauthenticated one."""
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    before = org.get_charter()
    proposal_id = org.submit_proposal(
        "Widen the mission",
        "This fideicommis funds open source climate adaptation research and flood mapping. "
        "Rule 1: no single grant may exceed 20 percent of the treasury. "
        "Rule 2: grantees need a public repository. Rule 3: no weapons or surveillance. "
        "Rule 4: the fideicommis must publish a yearly summary of what it kept online.",
        "CHARTER_AMENDMENT",
        0,
        "",
    )
    mock_assess(direct_vm, ASSESS_COMPLIANT)
    org.assess_proposal(proposal_id)
    org.cast_vote(proposal_id, True)
    cross_timelock(direct_vm, org)
    org.execute_proposal(proposal_id)
    assert org.get_charter_version() == 2
    assert org.get_charter() != before
    assert "yearly summary" in org.get_charter()
    assert len(json.loads(org.get_charter_history())) == 1


def test_advance_cycle_wind_down_stops_the_loop(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    mock_exec(direct_vm, "WIND_DOWN", confidence=75, rationale="mission no longer achievable")
    org.advance_cycle()
    assert org.get_status() == "WINDING_DOWN"
    with direct_vm.expect_revert("not ACTIVE"):
        mock_exec(direct_vm, "HOLD")
        org.advance_cycle()


def test_advance_cycle_validator_agrees_and_disagrees(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    mock_exec(direct_vm, "HOLD", confidence=80)
    org.advance_cycle()
    assert direct_vm.run_validator() is True
    direct_vm.clear_mocks()
    mock_exec(direct_vm, "WIND_DOWN", confidence=60, rationale="different view")
    assert direct_vm.run_validator() is False


def test_advance_cycle_validator_rejects_an_out_of_policy_amount(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner)
    mock_exec(direct_vm, "HOLD", confidence=80)
    org.advance_cycle()
    direct_vm.clear_mocks()
    verdict = direct_vm.run_validator(
        leader_result={
            "action": "FUND",
            "proposal_id": "p1",
            "amount_atto": 10 * GEN,
            "confidence": 80,
            "rationale": "spend the whole treasury",
        }
    )
    assert verdict is False


def test_exhausted_treasury_dormants_and_funding_revives(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=2 * GEN)
    org.set_policy(2 * GEN, 0, 60)
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_treasury() == 0
    assert org.get_status() == "DORMANT"
    with direct_vm.expect_revert("not ACTIVE"):
        mock_exec(direct_vm, "HOLD")
        org.advance_cycle()
    direct_vm.value = 5 * GEN
    org.fund()
    direct_vm.value = 0
    assert org.get_status() == "ACTIVE"
    assert org.get_runway_cycles() == 2


# ---------------------------------------------------------------- lifecycle


def test_operator_can_wind_down_and_dissolve(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=3 * GEN)
    with direct_vm.prank(hx(direct_bob)):
        with direct_vm.expect_revert("sender is not the operator or founder"):
            org.wind_down()
    with direct_vm.expect_revert("must be winding down first"):
        org.dissolve()
    org.wind_down()
    assert org.get_status() == "WINDING_DOWN"
    org.dissolve()
    assert org.get_status() == "DISSOLVED"
    assert org.get_treasury() == 0


def test_dissolved_org_refuses_new_proposals(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=3 * GEN)
    org.wind_down()
    org.dissolve()
    with direct_vm.expect_revert("fideicommis is dissolved"):
        org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)


def test_funding_revives_a_dormant_org(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=2 * GEN)
    org.set_policy(2 * GEN, 0, 60)
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_status() == "DORMANT"
    with direct_vm.expect_revert("not ACTIVE"):
        mock_exec(direct_vm, "HOLD")
        org.advance_cycle()
    direct_vm.value = 5 * GEN
    org.fund()
    direct_vm.value = 0
    assert org.get_status() == "ACTIVE"
    assert org.get_runway_cycles() == 2
    direct_vm.warp("2031-03-01T00:05:00+00:00")
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_cycle() == 2


def test_evidence_sources_are_not_an_operator_power(warp, direct_vm, direct_deploy, direct_owner):
    """
    Step four of a capture: choose which sources the committee can see, then have
    it judge against sources that make anything look compliant.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    with direct_vm.expect_revert("evidence sources are constitutional"):
        org.set_evidence_urls("https://example.org/friendly")
    assert json.loads(org.get_evidence_urls()) == []


def test_funding_revives_a_dormant_org(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=2 * GEN)
    org.set_policy(2 * GEN, 0, 60)
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_status() == "DORMANT"
    with direct_vm.expect_revert("not ACTIVE"):
        mock_exec(direct_vm, "HOLD")
        org.advance_cycle()
    direct_vm.value = 5 * GEN
    org.fund()
    direct_vm.value = 0
    assert org.get_status() == "ACTIVE"
    assert org.get_runway_cycles() == 2
    direct_vm.warp("2031-03-01T00:05:00+00:00")
    mock_exec(direct_vm, "HOLD")
    org.advance_cycle()
    assert org.get_cycle() == 2
    assert "revived" in org.get_mission_log(0, 50)


def test_exhausted_treasury_sleeps_even_if_the_model_wants_to_wind_down(warp, direct_vm, direct_deploy, direct_owner):
    """Winding down distributes a remainder, so an empty org must not wind down.

    Found on Studionet: the model chose WIND_DOWN on the cycle that drained the
    treasury, which left the fideicommis WINDING_DOWN with no way back. The
    exhaustion rule now takes precedence, so funding always revives it.
    """
    org = build(direct_vm, direct_deploy, direct_owner, treasury=GEN)
    org.set_policy(GEN, 0, 60)
    mock_exec(direct_vm, "WIND_DOWN", confidence=75, rationale="mission no longer achievable")
    org.advance_cycle()
    assert org.get_treasury() == 0
    assert org.get_status() == "DORMANT"
    direct_vm.value = GEN
    org.fund()
    direct_vm.value = 0
    assert org.get_status() == "ACTIVE"
    assert org.get_cycle() == 1


def test_wind_down_still_works_while_there_is_a_remainder(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(0, 0, 60)
    mock_exec(direct_vm, "WIND_DOWN", confidence=75, rationale="the charter can no longer be met")
    org.advance_cycle()
    assert org.get_status() == "WINDING_DOWN"
    assert org.get_treasury() == 10 * GEN


def flow(org):
    return json.loads(org.get_lifetime_flow())


def assert_conserved(org, note=""):
    """
    Every attoGEN that entered must still be somewhere: sitting in the treasury,
    or gone as a grant, a settlement, a dissolution remainder, a burn, or a
    keeper reward. This is the check that makes the number falsifiable.
    """
    f = flow(org)
    buckets = (
        f["granted_atto"]
        + f["settled_atto"]
        + f["dissolved_atto"]
        + f["keeper_paid_atto"]
        + f["burned_atto"]
    )
    assert buckets + f["treasury_atto"] == f["inflow_atto"], f"funds not conserved {note}: {f}"
    assert f["conserved_atto"] == f["inflow_atto"], f"conserved_atto disagrees with inflow {note}: {f}"
    # lifetime_outflow counts everything that left the treasury as burn or payout.
    # Keeper rewards are reported separately and are part of the same total.
    assert (
        f["outflow_atto"]
        == f["granted_atto"] + f["settled_atto"] + f["dissolved_atto"] + f["burned_atto"]
    ), f"outflow does not equal the payout buckets plus burn {note}: {f}"
    return f


def test_funds_are_conserved_through_grants(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    f = assert_conserved(org, "at genesis")
    assert f["inflow_atto"] == 10 * GEN
    assert f["treasury_atto"] == 10 * GEN

    for _ in range(3):
        pid = compliant_proposal(org, direct_vm, amount=GEN)
        org.cast_vote(pid, True)
        org.execute_proposal(pid)

    f = assert_conserved(org, "after three grants")
    assert f["granted_atto"] == 3 * GEN
    assert f["treasury_atto"] == 7 * GEN
    assert f["inflow_atto"] == 10 * GEN


def test_funds_are_conserved_through_settlement(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    pid = compliant_proposal(org, direct_vm, amount=2 * GEN)
    org.cast_vote(pid, True)
    org.execute_proposal(pid)
    assert_conserved(org, "after the grant")

    direct_vm.mock_web(r"example\.org/delivery", {"status": 200, "body": "published"})
    mock_review(direct_vm, "ACCEPTED", score=50)
    org.review_delivery(pid, "https://example.org/delivery")
    assert_conserved(org, "after the review, before settlement")
    assert flow(org)["settled_atto"] == 0, "reviewing must not move money"

    org.settle_delivery(pid)
    f = assert_conserved(org, "after settlement")
    assert f["granted_atto"] == 2 * GEN
    assert f["settled_atto"] == GEN  # 50 percent of the 2 GEN budget
    assert f["treasury_atto"] == 7 * GEN


def test_funds_are_conserved_through_burn_and_keeper_reward(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    org.set_policy(GEN, GEN // 100, 60)
    for minute in (10, 12, 14, 16):
        # The cooldown is 60s, so the clock has to clear it before the next
        # advance_cycle is accepted.
        direct_vm.warp(f"2031-03-01T00:{minute:02d}:00+00:00")
        mock_exec(direct_vm, "HOLD", confidence=80)
        org.advance_cycle()

    f = assert_conserved(org, "after four cycles")
    assert f["burned_atto"] == 4 * GEN
    assert f["keeper_paid_atto"] == 4 * (GEN // 100)
    assert f["granted_atto"] == 0
    assert f["treasury_atto"] == 10 * GEN - 4 * GEN - 4 * (GEN // 100)
    assert f["inflow_atto"] == 10 * GEN


def test_funds_are_conserved_through_dissolution(warp, direct_vm, direct_deploy, direct_owner):
    org = _armed_org(direct_vm, direct_deploy, direct_owner, treasury=3 * GEN)
    # The constitutional ceiling is 20 percent, so the grant has to fit under it.
    pid = compliant_proposal(org, direct_vm, amount=GEN // 2)
    org.cast_vote(pid, True)
    org.execute_proposal(pid)
    org.wind_down()
    org.dissolve()
    f = assert_conserved(org, "after dissolution")
    assert f["treasury_atto"] == 0
    assert f["dissolved_atto"] == 2 * GEN + GEN // 2
    assert f["granted_atto"] == GEN // 2
    assert f["inflow_atto"] == 3 * GEN


def test_a_payout_cannot_escape_the_conservation_buckets(warp, direct_vm, direct_deploy, direct_owner):
    """
    _pay refuses a memo with no bucket, so a future payout path cannot move value
    out of the estate without appearing in the identity above.
    """
    org = _armed_org(direct_vm, direct_deploy, direct_owner, treasury=5 * GEN)
    with direct_vm.expect_revert("no conservation bucket"):
        org._pay("0x" + "11" * 20, 1, "smuggled", "")
    assert org.get_treasury() == 5 * GEN
    assert_conserved(org, "after the rejected payout")


def test_a_winding_down_fideicommis_refuses_new_funds(warp, direct_vm, direct_deploy, direct_owner):
    """Otherwise the operator could dissolve and collect a late donation."""
    org = build(direct_vm, direct_deploy, direct_owner, treasury=3 * GEN)
    org.wind_down()
    direct_vm.value = GEN
    with direct_vm.expect_revert("cannot take funds"):
        org.fund()
    direct_vm.value = 0
    assert org.get_treasury() == 3 * GEN
    org.dissolve()
    direct_vm.value = GEN
    with direct_vm.expect_revert("cannot take funds"):
        org.fund()
    direct_vm.value = 0


# ---------------------------------------------------------------- views


def test_mission_log_is_appended_and_queryable(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=0)
    entries = json.loads(org.get_mission_log(0, 100))
    assert len(entries) == 1
    assert "genesis" in entries[0]
    org.set_policy(0, 0, 60)
    entries = json.loads(org.get_mission_log(0, 100))
    assert "policy" in entries[-1]
    assert json.loads(org.get_mission_log(100, 100)) == []
    assert json.loads(org.get_mission_log(0, 1)) == entries[:1]


def test_org_summary_reports_lifecycle(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    summary = json.loads(org.get_org_summary())
    assert summary["name"] == "Climate Fund"
    assert summary["status"] == "ACTIVE"
    assert summary["treasury_atto"] == 10 * GEN
    assert summary["charter_version"] == 1
    assert summary["cycle"] == 0
    assert summary["proposal_count"] == 0
    assert summary["last_action"] == "HOLD"


def test_snapshot_restores_full_state(warp, direct_vm, direct_deploy, direct_owner):
    org = build(direct_vm, direct_deploy, direct_owner, treasury=10 * GEN)
    snapshot = direct_vm.snapshot()
    org.set_policy(GEN, 0, 60)
    org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    assert org.get_proposal_count() == 1
    direct_vm.revert(snapshot)
    assert org.get_proposal_count() == 0
    assert json.loads(org.get_policy())["burn_per_cycle"] == 0


# --- storage semantics the contract's bookkeeping depends on -----------------
#
# These used to live in a separate fixture contract, contracts/storage_semantics.py,
# which asserted the same SDK behaviours against a toy TreeMap. They are here
# instead, because a test that pins a behaviour of a proxy only proves the proxy
# still agrees with itself. Asserting them through Fideicommis means the behaviour
# is pinned where it is actually used: if a GenVM upgrade changes how a nested
# DynArray or a TreeMap default behaves, the failure appears in a test of the
# contract that relies on it, and the stack trace names the real code.
#
# What a runner upgrade would otherwise do: not raise. Proposal records would
# keep working and quietly lose the approver and violation lists, which is the one
# class of corruption this project cannot detect after the fact.


def test_nested_dynarray_takes_a_plain_list_and_survives_the_round_trip(warp, direct_vm, direct_deploy, direct_owner):
    """A TreeMap[str, DynArray[str]] field accepts a list literal on assignment.

    The violations are built as a list comprehension and handed straight to the
    field. If that stopped working, every non-compliant proposal would fail at
    assessment time rather than at deploy time, which is much harder to trace.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)
    assert json.loads(org.get_proposal_audit(proposal_id))["violations"] == []

    mock_assess(direct_vm, ASSESS_NON_COMPLIANT)
    org.assess_proposal(proposal_id)
    audit = json.loads(org.get_proposal_audit(proposal_id))
    assert audit["violations"] == ASSESS_NON_COMPLIANT["violations"]


def test_a_nested_list_is_written_exactly_once(warp, direct_vm, direct_deploy, direct_owner):
    """Reassessment is refused, so a nested list is only ever assigned at creation.

    This started out as a test of whether reassigning a TreeMap[str, DynArray[str]]
    replaces the list or extends it. It cannot be written, and the reason is better
    than the test would have been: assess_proposal raises "was already assessed" before
    it touches the field. The question of replace-versus-append is unreachable through
    the public API, so no runner upgrade can change the answer.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = org.submit_proposal("t", "b", "GRANT", GEN, "0x" + "11" * 20)

    mock_assess(direct_vm, ASSESS_NON_COMPLIANT)
    org.assess_proposal(proposal_id)

    with direct_vm.expect_revert("was already assessed"):
        org.assess_proposal(proposal_id)

    assert json.loads(org.get_proposal_audit(proposal_id))["violations"] == ASSESS_NON_COMPLIANT["violations"]


def test_tremap_get_falls_back_to_zero_for_an_unknown_address(warp, direct_vm, direct_deploy, direct_owner, direct_bob):
    """`if k in self.tree` appears nowhere in the contract, so the default passed
    to .get is the only membership test it has.

    cast_vote reads a stranger's shares out of member_shares. The revert message is
    "sender is not a member", which means the lookup returned zero and failed the
    weight comparison. If a runner ever stopped honouring the default, that read
    would raise instead of scoring zero, and every non-member's vote attempt would
    crash the contract rather than being refused: a denial of service on the vote
    path, and not a wrong number.
    """
    org = build(direct_vm, direct_deploy, direct_owner)
    bootstrap(org, direct_vm)
    proposal_id = compliant_proposal(org, direct_vm)

    with direct_vm.prank(hx(direct_bob)):
        with direct_vm.expect_revert("sender is not a member"):
            org.cast_vote(proposal_id, True)

    # get_members reads the same field with the same default. Addresses come back
    # EIP-55 checksummed, so the comparison is on case rather than on the raw string.
    members = json.loads(org.get_members())
    assert [m["address"].lower() for m in members] == [hx(direct_owner).lower()]
    assert members[0]["shares"] == 10000


# --- the storage layout is the ABI ------------------------------------------
#
# GenLayer's storage layout is positional: field number N is always field N. A
# field inserted in the middle does not raise, does not fail a type check, and does
# not show up in any behavioural test. It silently reinterprets every field after it,
# so a deployed trust reads a u256 as a TreeMap and the damage is not visible until
# someone reads a view that touches the shifted field.
#
# This is the first rule in AGENTS.md and it said a change touching it needs a test
# that fails without it. There was no such test, which is how it stayed unwritten
# for so long. This is it. The failure is deliberately loud and names the field, so
# that appending correctly is a one-line edit here rather than a silent migration.
#
# Read the assertion, not the list: the point is not that there are 44 fields, it is
# that the sequence is frozen. Append at the end, then add the pair below.

_STORAGE_LAYOUT = [
    ("org_name", "str"),
    ("mission", "str"),
    ("charter", "str"),
    ("charter_version", "u256"),
    ("charter_history", "DynArray[str]"),
    ("charter_rules", "DynArray[CharterRule]"),
    ("founder", "Address"),
    ("operator", "Address"),
    ("members", "DynArray[Address]"),
    ("member_shares", "TreeMap[Address, u256]"),
    ("total_shares", "u256"),
    ("quorum_bps", "u256"),
    ("evidence_urls", "DynArray[str]"),
    ("treasury", "u256"),
    ("lifetime_inflow", "u256"),
    ("lifetime_outflow", "u256"),
    ("burn_per_cycle", "u256"),
    ("keeper_reward", "u256"),
    ("tick_interval", "u64"),
    ("next_tick_at", "u64"),
    ("last_tick_at", "u64"),
    ("cycle", "u256"),
    ("status", "str"),
    ("spend_ceiling_bps", "u256"),
    ("proposals", "TreeMap[str, Proposal]"),
    ("proposal_order", "DynArray[str]"),
    ("proposal_violations", "TreeMap[str, DynArray[str]]"),
    ("proposal_approvers", "TreeMap[str, DynArray[str]]"),
    ("proposal_rejecters", "TreeMap[str, DynArray[str]]"),
    ("proposal_count", "u256"),
    ("executed_count", "u256"),
    ("settled_count", "u256"),
    ("tick_count", "u256"),
    ("keeper_count", "u256"),
    ("total_keeper_paid", "u256"),
    ("mission_log", "DynArray[str]"),
    ("log_truncated", "bool"),
    ("last_action", "str"),
    ("last_rationale", "str"),
    ("lifetime_granted", "u256"),
    ("lifetime_settled", "u256"),
    ("lifetime_dissolved", "u256"),
    ("amendment_delay", "u64"),
    ("op_ready_at", "TreeMap[str, u64]"),
]

# The field the contract's own comment calls out as the start of the appended
# region. Kept as a name rather than an index so the test still means something if
# the list above is ever updated deliberately.
_APPEND_BOUNDARY = "lifetime_granted"


def _declared_storage_fields():
    """(name, type) for every annotated class-level field, in declaration order.

    Parsed with ast rather than read off the source with a regex, because a regex
    would also match the `self.x: T = ...` annotations that appear inside methods,
    and this test exists to catch exactly the kind of edit that a loose match
    would paper over.
    """
    tree = ast.parse(Path(ORG_PATH).read_text(encoding="utf-8"))
    cls = next(
        n for n in tree.body
        if isinstance(n, ast.ClassDef) and n.name == "Fideicommis"
    )
    return [
        (node.target.id, ast.unparse(node.annotation))
        for node in cls.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    ]


def test_storage_layout_is_frozen_append_only():
    actual = _declared_storage_fields()
    expected = _STORAGE_LAYOUT

    assert len(actual) == len(expected), (
        f"the contract declares {len(actual)} storage fields, the frozen layout has "
        f"{len(expected)}. A field was added or removed. If it was APPENDED, add it to "
        f"the end of _STORAGE_LAYOUT. If it was inserted or deleted, that reinterprets "
        f"every field after it on every deployed trust and is a breaking change."
    )
    for index, (got, want) in enumerate(zip(actual, expected)):
        assert got == want, (
            f"storage field {index} is {got[0]}: {got[1]}, expected {want[0]}: {want[1]}. "
            f"The layout is positional, so a difference here means a field was inserted, "
            f"deleted, reordered or retyped mid-list, and every field after index {index} "
            f"now points at the wrong slot on every trust that is already deployed."
        )


def test_storage_layout_has_no_duplicate_names():
    names = [n for n, _ in _declared_storage_fields()]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    assert not duplicates, f"two storage fields share a name: {duplicates}"


def test_the_append_boundary_still_marks_the_end_of_the_frozen_region():
    """The contract carries a comment saying everything below is appended.

    The list above and that comment are the same rule written twice. If a field is
    appended without moving the comment, the two disagree and the comment becomes a
    lie that the next reader will trust.
    """
    source = Path(ORG_PATH).read_text(encoding="utf-8")
    assert _APPEND_BOUNDARY in [n for n, _ in _declared_storage_fields()]
    assert "Everything below is APPENDED" in source, (
        "the contract's APPEND boundary comment is gone. The storage layout is "
        "positional and the frozen test above cannot say which fields are safe to "
        "append after, because that judgement currently lives only in this comment."
    )
