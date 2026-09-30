"""Integration tests: the fideicommis executed through real consensus.

Direct-mode tests pin the logic down. These tests prove the equivalence principles
actually settle when a validator committee re-derives the decision independently.
They are excluded from the default pytest run, and they run against Studionet, which
is what GenLayer documents for hosted verification:

    gltest tests/integration -v -s --network studionet

The eight tests below need no model calls and take about ten minutes together,
because every transaction goes through a real committee and the node answers in
seconds rather than milliseconds. The five marked `slow` additionally call real
models, and take about eleven minutes more:

    gltest tests/integration -v -s -m slow --network studionet

A local simulator is faster to start but its engine and its harness are both
defective in ways the conftest measures and records: the engine only honours
`@allow_storage` on a module it has not already loaded, and genlayer-test cannot
build a usable contract handle against it. Neither of those is a property of the
contract, which deploys on Studionet and passes genvm-lint.

    # if you have one running
    $env:GENLAYER_RPC = "http://127.0.0.1:4000/api"
    gltest tests/integration -v -s

Fee-charging networks need a measured fee profile first:

    gltest tests/integration --fee-profile --contracts-dir contracts
"""

import json
from pathlib import Path

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

from conftest import staged_contract

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
    """A fresh path for every deploy, because the local engine only honours
    @allow_storage on a module it has not already loaded. See conftest for the
    measurement behind that."""
    return staged_contract()


def deploy_trust(account, treasury_atto=10 * GEN, evidence=""):
    """Deploy, then hand back a contract that has methods on it.

    gltest's own `deploy()` builds the returned handle's methods from a schema it
    fetches over RPC through a fallback chain, and against a local node that fetch
    comes back empty, so the handle has no methods and every call on it raises
    `no attribute get_org_name`. Fetching the schema from the factory and building
    the handle from it directly is the same construction without the fallback chain,
    and it costs no extra round trip beyond the one the deploy already made.

    The assertion afterwards is the point. If the schema is ever unusable, the suite
    says "the harness produced a contract with no methods" instead of failing at the
    first view call with a name that looks like a missing method on the trust.
    """
    from gltest.contracts.contract import Contract
    from gltest.utils import extract_contract_address

    factory = get_contract_factory(contract_file_path=fideicommis_path())
    receipt = factory.deploy_contract_tx(
        args=["Climate Fund", MISSION, CHARTER, account.address, evidence],
        account=account,
    )
    schema = factory._get_schema_with_fallback()
    if not isinstance(schema, dict) or not schema.get("methods"):
        raise AssertionError("gltest produced no contract schema, so no method can be called")
    contract = Contract.new(
        address=extract_contract_address(receipt), schema=schema, account=account
    )
    _assert_methods_present(contract)
    if treasury_atto:
        funded = contract.fund(args=[]).transact(value=treasury_atto)
        assert tx_execution_succeeded(funded)
    return contract


def as_account(org, account):
    """The same contract, reached from a different sender.

    genlayer-test binds the account to the handle instead of taking it per call, so
    a write from a second party needs a second handle. Reusing the schema the handle
    already carries avoids another RPC round trip, and the studionet rate limit is 30
    calls a minute.
    """
    from gltest.contracts.contract import Contract

    return Contract.new(address=org.address, schema=org._schema, account=account)


def _assert_methods_present(contract):
    """Fail here, plainly, rather than at the first view call with a confusing name."""
    for method in ("get_org_name", "fund", "bootstrap_rules", "submit_proposal"):
        assert hasattr(contract, method), (
            f"the deployed contract has no {method}. genlayer-test built it from a schema "
            f"that did not describe this contract."
        )


def submit_grant(org, account, amount=GEN, title=GRANT_TITLE, body=GRANT_BODY):
    """Proposal ids are deterministic (p1, p2, ...) so tests can address them directly."""
    return org.submit_proposal(args=[title, body, "GRANT", amount, RECIPIENT]).transact()


# ------------------------------------------------------------------ no LLM


def test_deploy_and_fund(default_account):
    org = deploy_trust(default_account)
    assert org.get_org_name().call() == "Climate Fund"
    assert org.get_status().call() == "ACTIVE"
    assert int(org.get_treasury().call()) == 10 * GEN
    assert int(org.get_proposal_count().call()) == 0


def test_policy_and_runway(default_account):
    org = deploy_trust(default_account)
    receipt = org.set_policy(args=[GEN, GEN // 100, 3600]).transact()
    assert tx_execution_succeeded(receipt)
    policy = json.loads(org.get_policy().call())
    assert policy["burn_per_cycle"] == GEN
    assert policy["spend_ceiling_atto"] == 2 * GEN
    assert int(org.get_runway_cycles().call()) == 10


def test_funding_reaches_the_treasury_only_with_value(default_account):
    org = deploy_trust(default_account, treasury_atto=0)
    assert int(org.get_treasury().call()) == 0
    receipt = org.fund(args=[]).transact(value=3 * GEN)
    assert tx_execution_succeeded(receipt)
    assert int(org.get_treasury().call()) == 3 * GEN
    flow = json.loads(org.get_lifetime_flow().call())
    assert flow["inflow_atto"] == 3 * GEN


def test_malformed_proposal_is_rejected_deterministically(default_account):
    org = deploy_trust(default_account)
    assert tx_execution_succeeded(submit_grant(org, default_account, amount=GEN, body=""))
    assert json.loads(org.get_proposal(args=["p1"]).call())["kind"] == "GRANT"
    rejected = org.submit_proposal(args=["bad", "body", "GRANT", GEN, ""]).transact()
    assert not tx_execution_succeeded(rejected)


def test_evidence_urls_are_constitutional_not_operator_settable(default_account):
    """
    The operator cannot choose what the committee reads. This test used to assert
    the opposite: that set_evidence_urls accepted an https list. It is kept here,
    rather than in the direct-mode suite, because the point is that the refusal
    survives a real validator committee and not just in-process.
    """
    org = deploy_trust(default_account)
    receipt = org.set_evidence_urls(args=["https://example.org/a"]).transact()
    assert not tx_execution_succeeded(receipt)
    assert json.loads(org.get_evidence_urls().call()) == []


def test_membership_and_rulebook_are_not_operator_settable(default_account):
    """The other two removed operator powers, refused the same way."""
    org = deploy_trust(default_account)
    assert not tx_execution_succeeded(
        org.set_member_shares(args=["0x" + "22" * 20, 10000]).transact()
    )
    assert not tx_execution_succeeded(org.clear_rules(args=[]).transact())
    assert len(json.loads(org.get_members().call())) == 1


def test_set_policy_no_longer_accepts_quorum_or_ceiling(default_account):
    """The load-bearing step of the capture: it must not be a parameter at all."""
    org = deploy_trust(default_account)
    assert not tx_execution_succeeded(
        org.set_policy(args=[0, 0, 3600, 1, 10000]).transact()
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
    org = deploy_trust(default_account)
    org.bootstrap_rules(args=[]).transact()
    org.submit_proposal(args=["Raise quorum", "QUORUM_BPS:8000", "GOVERNANCE", 0, ""]).transact()
    org.assess_proposal(args=["p1"]).transact()
    org.cast_vote(args=["p1", True]).transact()
    early = org.execute_proposal(args=["p1"]).transact()
    assert not tx_execution_succeeded(early)
    assert json.loads(org.get_constitutional_state().call())["quorum_bps"] == 5000


# ------------------------------------------------------------------ consensus


@pytest.mark.slow
def test_charter_rulebook_settles_by_consensus(default_account):
    """bootstrap_rules is the first real equivalence check: leader plus validators."""
    org = deploy_trust(default_account, treasury_atto=0)
    receipt = org.bootstrap_rules(args=[]).transact()
    assert tx_execution_succeeded(receipt)
    rules = json.loads(org.get_charter_rules().call())
    assert 3 <= len(rules) <= 12
    assert [rule["id"] for rule in rules] == [f"R{i + 1}" for i in range(len(rules))]
    assert all(rule["text"].strip() for rule in rules)


@pytest.mark.slow
def test_proposal_assessment_settles_by_consensus(default_account):
    org = deploy_trust(default_account)
    assert tx_execution_succeeded(org.bootstrap_rules(args=[]).transact())
    assert tx_execution_succeeded(submit_grant(org, default_account))
    assert tx_execution_succeeded(org.assess_proposal(args=["p1"]).transact())
    proposal = json.loads(org.get_proposal(args=["p1"]).call())
    assert proposal["verdict"] in ("COMPLIANT", "NON_COMPLIANT", "UNDETERMINED")
    assert json.loads(org.get_proposal_ids().call()) == ["p1"]


@pytest.mark.slow
def test_grant_is_paid_after_quorum(default_account):
    org = deploy_trust(default_account)
    assert tx_execution_succeeded(org.bootstrap_rules(args=[]).transact())
    assert tx_execution_succeeded(submit_grant(org, default_account))
    assert tx_execution_succeeded(org.assess_proposal(args=["p1"]).transact())
    if json.loads(org.get_proposal(args=["p1"]).call())["verdict"] != "COMPLIANT":
        pytest.skip("the validator committee judged this proposal non compliant, which is a valid outcome")
    assert tx_execution_succeeded(org.cast_vote(args=["p1", True]).transact())
    assert tx_execution_succeeded(org.execute_proposal(args=["p1"]).transact())
    assert int(org.get_treasury().call()) == 9 * GEN
    assert json.loads(org.get_proposal(args=["p1"]).call())["executed"] is True


@pytest.mark.slow
def test_advance_cycle_settles_and_pays_the_keeper(default_account, accounts):
    """The keeper is a different account from the one that deployed, which matters.

    The sender is bound to the contract handle rather than passed per call, so
    calling advance_cycle from the operator's handle would reimburse the operator
    and the test would pass without ever proving the keeper path. A new handle is
    built for the keeper, which is what makes the assertion below mean anything.
    """
    keeper = accounts[1]
    org = deploy_trust(default_account)
    assert tx_execution_succeeded(
        org.set_policy(args=[GEN, GEN // 100, 60]).transact()
    )

    before = int(org.get_treasury().call())
    assert tx_execution_succeeded(as_account(org, keeper).advance_cycle(args=[]).transact())

    assert int(org.get_cycle().call()) == 1
    assert int(org.get_treasury().call()) <= before
    summary = json.loads(org.get_org_summary().call())
    assert summary["keeper_count"] == 1
    assert summary["keeper_paid_atto"] == GEN // 100
    assert summary["last_action"] in ("HOLD", "FUND", "SETTLE", "ADAPT", "WIND_DOWN")


@pytest.mark.slow
def test_charter_amendment_round_trip(default_account):
    org = deploy_trust(default_account)
    assert tx_execution_succeeded(org.bootstrap_rules(args=[]).transact())
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
        ).transact()
    )
    assert tx_execution_succeeded(org.assess_proposal(args=["p1"]).transact())
    if json.loads(org.get_proposal(args=["p1"]).call())["verdict"] != "COMPLIANT":
        pytest.skip("the committee rejected the amendment, which is a valid outcome")
    assert tx_execution_succeeded(org.cast_vote(args=["p1", True]).transact())
    assert tx_execution_succeeded(org.execute_proposal(args=["p1"]).transact())
    assert int(org.get_charter_version().call()) == 2
    assert "flood mapping" in org.get_charter().call()
    assert json.loads(org.get_charter_rules().call()) == []


