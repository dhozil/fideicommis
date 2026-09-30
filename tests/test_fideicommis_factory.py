import json

import pytest

PATH = "contracts/fideicommis_factory.py"

MISSION = "Keep coastal flood defences maintained for the villages that need them."
CHARTER = "Rule 1: no single grant may exceed 10 percent of the treasury."

TEMPLATE = (
    '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }\n'
    "from genlayer import *\n"
    "\n"
    "class Fideicommis(gl.Contract):\n"
    "    def __init__(self, name, mission, charter, operator, urls):\n"
    "        pass\n"
)

WRONG_CLASS = "class SomethingElse(gl.Contract):\n    pass\n"
NO_RUNNER_HEADER = "class Fideicommis(gl.Contract):\n    pass\n"


def hx(address) -> str:
    if isinstance(address, bytes):
        return "0x" + address.hex()
    return str(address)


def same_address(left, right) -> bool:
    """str(Address) is checksummed on the way out, so compare case insensitively."""
    return str(left).lower() == str(right).lower()


@pytest.fixture
def factory(direct_deploy, direct_owner):
    return direct_deploy(PATH)


def test_starts_empty(factory):
    assert factory.get_org_count() == 0
    assert json.loads(factory.get_org_names()) == []
    status = json.loads(factory.get_template_status())
    assert status["provisioned"] is False
    assert status["bytes"] == 0
    assert status["deployed_from_template"] == 0


def test_deploy_org_refuses_without_a_template(factory, direct_owner):
    """The guard has to fire before the child deploy, so the message is the proof."""
    with pytest.raises(Exception, match="no template provisioned"):
        factory.deploy_org("Coastal Trust", MISSION, CHARTER, "", hx(direct_owner))


def test_template_must_look_like_the_org_contract(factory):
    with pytest.raises(Exception, match="must define class Fideicommis"):
        factory.provision_template(WRONG_CLASS)
    with pytest.raises(Exception, match="pinned runner Depends header"):
        factory.provision_template(NO_RUNNER_HEADER)
    with pytest.raises(Exception, match="must not be empty"):
        factory.provision_template("")


def test_template_is_provisioned_once_and_then_frozen(factory):
    factory.provision_template(TEMPLATE)
    status = json.loads(factory.get_template_status())
    assert status["provisioned"] is True
    assert status["bytes"] == len(TEMPLATE)
    assert status["deployed_from_template"] == 0
    with pytest.raises(Exception, match="already provisioned"):
        factory.provision_template(TEMPLATE)


def test_only_the_deployer_may_provision(direct_deploy, direct_owner, direct_bob, direct_vm):
    factory = direct_deploy(PATH)
    assert same_address(factory.get_deployer(), hx(direct_owner))
    with direct_vm.prank(direct_bob):
        with pytest.raises(Exception, match="only the factory deployer"):
            factory.provision_template(TEMPLATE)
    assert json.loads(factory.get_template_status())["provisioned"] is False


def test_deploy_org_validates_its_arguments_before_deploying(factory, direct_owner):
    with pytest.raises(Exception, match="org_name must be between"):
        factory.deploy_org("", MISSION, CHARTER, "", hx(direct_owner))
    with pytest.raises(Exception, match="org_name must be between"):
        factory.deploy_org("x" * 121, MISSION, CHARTER, "", hx(direct_owner))
    with pytest.raises(Exception, match="mission must not be empty"):
        factory.deploy_org("Coastal Trust", "   ", CHARTER, "", hx(direct_owner))
    with pytest.raises(Exception, match="charter must not be empty"):
        factory.deploy_org("Coastal Trust", MISSION, "\t\n ", "", hx(direct_owner))


def test_unknown_org_is_rejected_everywhere(factory):
    for call in (
        lambda: factory.get_org_address("nope"),
        lambda: factory.get_org_status("nope"),
        lambda: factory.get_org_treasury("nope"),
        lambda: factory.get_org_runway("nope"),
        lambda: factory.get_org_summary("nope"),
        lambda: factory.poke("nope"),
    ):
        with pytest.raises(Exception, match="unknown fideicommis nope"):
            call()

