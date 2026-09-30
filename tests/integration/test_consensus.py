"""Integration tests: the fideicommis executed through real consensus.

Direct-mode tests pin the logic down. These tests prove the equivalence
principles actually settle when a validator committee re-derives the decision
independently. They need a running GenLayer network, so they live outside the
default pytest run.

    # terminal 1 - local network, no Docker required
    glsim --port 4000 --validators 5

    # terminal 2
    gltest tests/integration -v -s --contracts-dir contracts --network localnet

For a full GenVM (WASM) check, use GenLayer Studio instead of glsim:

    genlayer up
    gltest tests/integration -v -s --contracts-dir contracts --network localnet

Fee-charging networks need a measured fee profile first:

    gltest tests/integration --fee-profile --contracts-dir contracts
"""

import json
from pathlib import Path

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

ROOT = Path(__file__).resolve().parents[2]

GEN = 10 ** 18

MISSION = "Permanently fund verifiable open source climate adaptation research."

CHARTER = (
    "This fideicommis exists to fund open source climate adaptation research and nothing else. "
    "Rule 1: no single grant may exceed 10 percent of the treasury. "
    "Rule 2: a grantee must have a public and verifiable repository before any funds are released. "
    "Rule 3: the fideicommis must never fund weapons, surveillance tooling, or speculative trading. "
    "Rule 4: delivered work must be evidenced by a public source before a second tranche is released. "
    "Rule 5: changing any of these rules requires the same approval process as an ordinary grant."
)

GRANT_TITLE = "Grant for flood mapping"
GRANT_BODY = "Deliver a public flood risk dataset for the Mekong delta with an open licence."
RECIPIENT = "0x" + "11" * 20


def fideicommis_path() -> str:
    return str(ROOT / "contracts" / "fideicommis.py")


def factory_path() -> str:
    return str(ROOT / "contracts" / "fideicommis_factory.py")


def deploy_org(account, treasury_atto=10 * GEN, evidence=""):
    contract = get_contract_factory(contract_file_path=fideicommis_path()).deploy(
        args=["Climate Fund", MISSION, CHARTER, account.address, evidence],
        account=account,
    )
    if treasury_atto:
        receipt = contract.fund(args=[]).transact(value=treasury_atto, account=account)
        assert tx_execution_succeeded(receipt)
    return contract


def submit_grant(org, account, amount=GEN, title=GRANT_TITLE, body=GRANT_BODY):
    """Proposal ids are deterministic (p1, p2, ...) so tests can address them directly."""
    return org.submit_proposal(args=[title, body, "GRANT", amount, RECIPIENT], account=account)


def deploy_factory(account):
    return get_contract_factory(contract_file_path=factory_path()).deploy(args=[], account=account)


# ------------------------------------------------------------------ no LLM


def test_deploy_and_fund(default_account):
    org = deploy_org(default_account)
    assert org.get_org_name().call() == "Climate Fund"
    assert org.get_status().call() == "ACTIVE"
    assert int(org.get_treasury().call()) == 10 * GEN
    assert int(org.get_proposal_count().call()) == 0


def test_policy_and_runway(default_account):
    org = deploy_org(default_account)
    receipt = org.set_policy(args=[GEN, GEN // 100, 3600], account=default_account)
    assert tx_execution_succeeded(receipt)
    policy = json.loads(org.get_policy().call())
    assert policy["burn_per_cycle"] == GEN
    assert policy["spend_ceiling_atto"] == 2 * GEN
    assert int(org.get_runway_cycles().call()) == 10


def test_funding_reaches_the_treasury_only_with_value(default_account):
    org = deploy_org(default_account, treasury_atto=0)
    assert int(org.get_treasury().call()) == 0
    receipt = org.fund(args=[]).transact(value=3 * GEN, account=default_account)
    assert tx_execution_succeeded(receipt)
    assert int(org.get_treasury().call()) == 3 * GEN
    flow = json.loads(org.get_lifetime_flow().call())
    assert flow["inflow_atto"] == 3 * GEN


def test_malformed_proposal_is_rejected_deterministically(default_account):
    org = deploy_org(default_account)
    assert tx_execution_succeeded(submit_grant(org, default_account, amount=GEN, body=""))
    assert json.loads(org.get_proposal(args=["p1"]).call())["kind"] == "GRANT"
    rejected = org.submit_proposal(
        args=["bad", "body", "GRANT", GEN, ""], account=default_account
    ).transact()
    assert not tx_execution_succeeded(rejected)


def test_evidence_urls_are_constitutional_not_operator_settable(default_account):
    """
    The operator cannot choose what the committee reads. This test used to assert
    the opposite: that set_evidence_urls accepted an https list. It is kept here,
    rather than in the direct-mode suite, because the point is that the refusal
    survives a real validator committee and not just in-process.
    """
    org = deploy_org(default_account)
    receipt = org.set_evidence_urls(args=["https://example.org/a"], account=default_account)
    assert not tx_execution_succeeded(receipt)
    assert json.loads(org.get_evidence_urls().call()) == []


def test_membership_and_rulebook_are_not_operator_settable(default_account):
    """The other two removed operator powers, refused the same way."""
    org = deploy_org(default_account)
    assert not tx_execution_succeeded(
        org.set_member_shares(args=["0x" + "22" * 20, 10000], account=default_account)
    )
    assert not tx_execution_succeeded(org.clear_rules(args=[], account=default_account))
    assert len(json.loads(org.get_members().call())) == 1


def test_set_policy_no_longer_accepts_quorum_or_ceiling(default_account):
    """The load-bearing step of the capture: it must not be a parameter at all."""
    org = deploy_org(default_account)
    assert not tx_execution_succeeded(
        org.set_policy(args=[0, 0, 3600, 1, 10000], account=default_account)
    )
    state = json.loads(org.get_constitutional_state().call())
    assert state["quorum_bps"] == 5000
    assert state["spend_ceiling_bps"] == 2000
    assert state["min_quorum_bps"] == 2500
    assert state["max_spend_ceiling_bps"] == 5000
    assert state["amendment_delay"] > 0


def test_a_constitutional_change_is_timelocked_through_real_consensus(default_account):
    """
    Approved is not effective. The delay has to hold when a real committee is
    involved, which is the only place the timelock is genuinely adversarial.
    """
    org = deploy_org(default_account)
    org.bootstrap_rules(args=[], account=default_account)
    org.submit_proposal(args=["Raise quorum", "QUORUM_BPS:8000", "GOVERNANCE", 0, ""], account=default_account)
    org.assess_proposal(args=["p1"], account=default_account)
    org.cast_vote(args=["p1", True], account=default_account)
    early = org.execute_proposal(args=["p1"], account=default_account)
    assert not tx_execution_succeeded(early)
    assert json.loads(org.get_constitutional_state().call())["quorum_bps"] == 5000


# ------------------------------------------------------------------ consensus


@pytest.mark.slow
def test_charter_rulebook_settles_by_consensus(default_account):
    """bootstrap_rules is the first real equivalence check: leader plus validators."""
    org = deploy_org(default_account, treasury_atto=0)
    receipt = org.bootstrap_rules(args=[], account=default_account)
    assert tx_execution_succeeded(receipt)
    rules = json.loads(org.get_charter_rules().call())
    assert 3 <= len(rules) <= 12
    assert [rule["id"] for rule in rules] == [f"R{i + 1}" for i in range(len(rules))]
    assert all(rule["text"].strip() for rule in rules)


@pytest.mark.slow
def test_proposal_assessment_settles_by_consensus(default_account):
    org = deploy_org(default_account)
    assert tx_execution_succeeded(org.bootstrap_rules(args=[], account=default_account))
    assert tx_execution_succeeded(submit_grant(org, default_account))
    assert tx_execution_succeeded(org.assess_proposal(args=["p1"], account=default_account))
    proposal = json.loads(org.get_proposal(args=["p1"]).call())
    assert proposal["verdict"] in ("COMPLIANT", "NON_COMPLIANT", "UNDETERMINED")
    assert json.loads(org.get_proposal_ids().call()) == ["p1"]


@pytest.mark.slow
def test_grant_is_paid_after_quorum(default_account):
    org = deploy_org(default_account)
    assert tx_execution_succeeded(org.bootstrap_rules(args=[], account=default_account))
    assert tx_execution_succeeded(submit_grant(org, default_account))
    assert tx_execution_succeeded(org.assess_proposal(args=["p1"], account=default_account))
    if json.loads(org.get_proposal(args=["p1"]).call())["verdict"] != "COMPLIANT":
        pytest.skip("the validator committee judged this proposal non compliant, which is a valid outcome")
    assert tx_execution_succeeded(org.cast_vote(args=["p1", True], account=default_account))
    assert tx_execution_succeeded(org.execute_proposal(args=["p1"], account=default_account))
    assert int(org.get_treasury().call()) == 9 * GEN
    assert json.loads(org.get_proposal(args=["p1"]).call())["executed"] is True


@pytest.mark.slow
def test_advance_cycle_settles_and_pays_the_keeper(default_account, accounts):
    keeper = accounts[1]
    org = deploy_org(default_account)
    assert tx_execution_succeeded(
        org.set_policy(args=[GEN, GEN // 100, 60], account=default_account)
    )

    before = int(org.get_treasury().call())
    assert tx_execution_succeeded(org.advance_cycle(args=[], account=keeper))

    assert int(org.get_cycle().call()) == 1
    assert int(org.get_treasury().call()) <= before
    summary = json.loads(org.get_org_summary().call())
    assert summary["keeper_count"] == 1
    assert summary["keeper_paid_atto"] == GEN // 100
    assert summary["last_action"] in ("HOLD", "FUND", "SETTLE", "ADAPT", "WIND_DOWN")


@pytest.mark.slow
def test_charter_amendment_round_trip(default_account):
    org = deploy_org(default_account)
    assert tx_execution_succeeded(org.bootstrap_rules(args=[], account=default_account))
    assert tx_execution_succeeded(
        org.submit_proposal(
            args=[
                "New charter",
                "This fideicommis funds open source climate adaptation research and flood mapping. "
                "Rule 1: no single grant may exceed 20 percent of the treasury.",
                "CHARTER_AMENDMENT",
                0,
                "",
            ],
            account=default_account,
        )
    )
    assert tx_execution_succeeded(org.assess_proposal(args=["p1"], account=default_account))
    if json.loads(org.get_proposal(args=["p1"]).call())["verdict"] != "COMPLIANT":
        pytest.skip("the committee rejected the amendment, which is a valid outcome")
    assert tx_execution_succeeded(org.cast_vote(args=["p1", True], account=default_account))
    assert tx_execution_succeeded(org.execute_proposal(args=["p1"], account=default_account))
    assert int(org.get_charter_version().call()) == 2
    assert "flood mapping" in org.get_charter().call()
    assert json.loads(org.get_charter_rules().call()) == []


# ------------------------------------------------------------------ factory


def test_factory_deploys_and_registers_child_fideicommises(default_account):
    factory = deploy_factory(default_account)
    assert int(factory.get_org_count().call()) == 0

    assert tx_execution_succeeded(
        factory.deploy_org(
            args=[
                "Coastal Trust",
                "Keep coastal flood defences maintained for the villages that need them.",
                CHARTER,
                "",
                default_account.address,
            ],
            account=default_account,
        )
    )

    assert int(factory.get_org_count().call()) == 1
    assert json.loads(factory.get_org_names().call()) == ["Coastal Trust"]
    org_address = factory.get_org_address(args=["Coastal Trust"]).call()
    assert org_address.lower() != default_account.address.lower()
    assert factory.get_org_status(args=["Coastal Trust"]).call() == "ACTIVE"
    assert int(factory.get_org_treasury(args=["Coastal Trust"]).call()) == 0
    assert json.loads(factory.get_org_summary(args=["Coastal Trust"]).call())["name"] == "Coastal Trust"


def test_factory_rejects_a_duplicate_name(default_account):
    factory = deploy_factory(default_account)
    args = ["Duplicate", MISSION, CHARTER, "", default_account.address]
    assert tx_execution_succeeded(factory.deploy_org(args=args, account=default_account))
    second = factory.deploy_org(args=args, account=default_account)
    assert not tx_execution_succeeded(second)
    assert int(factory.get_org_count().call()) == 1
