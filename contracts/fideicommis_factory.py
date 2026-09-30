# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json


MAX_TEMPLATE_BYTES = 200000
ORG_CONTRACT_MARKER = "class Fideicommis(gl.Contract)"
RUNNER_MARKER = '"Depends"'


@gl.contract_interface
class FideicommisRef:
    class View:
        def get_org_name(self) -> str: ...
        def get_mission(self) -> str: ...
        def get_charter(self) -> str: ...
        def get_charter_version(self) -> u256: ...
        def get_status(self) -> str: ...
        def get_treasury(self) -> u256: ...
        def get_cycle(self) -> u256: ...
        def get_runway_cycles(self) -> u256: ...
        def get_org_summary(self) -> str: ...

    class Write:
        def advance_cycle(self) -> None: ...


@allow_storage
@dataclass
class OrgRecord:
    address: Address
    name: str
    deployer: Address
    deployed_at: str
    index: u256
    template_bytes: u256


@allow_storage
class FideicommisFactory(gl.Contract):
    deployer: Address
    org_count: u256
    orgs: TreeMap[str, OrgRecord]
    org_by_address: TreeMap[Address, str]
    org_order: DynArray[str]
    org_template: str
    template_provisioned_at: str
    template_bytes: u256
    template_deploy_count: u256

    def __init__(self) -> None:
        self.deployer = gl.message.sender_address
        self.org_count = u256(0)
        self.template_provisioned_at = ""
        self.template_bytes = u256(0)
        self.template_deploy_count = u256(0)

    @gl.public.write
    def provision_template(self, code: str) -> None:
        """Store the Fideicommis source that deploy_org will instantiate.

        The source is passed in rather than read from a path inside the sandbox
        because a single-file deployment carries no sibling files. That was not an
        assumption: an earlier version of this factory read the path and failed on
        Studionet for every deployment with "source not found", which is why the
        template arrives as an argument and is then frozen.
        """
        self._require_deployer()
        source = str(code)
        if len(source) == 0:
            raise gl.vm.UserError("[EXPECTED] template code must not be empty")
        if len(source) > MAX_TEMPLATE_BYTES:
            raise gl.vm.UserError(f"[EXPECTED] template exceeds {MAX_TEMPLATE_BYTES} bytes")
        if ORG_CONTRACT_MARKER not in source:
            raise gl.vm.UserError(f"[EXPECTED] template must define {ORG_CONTRACT_MARKER}")
        if RUNNER_MARKER not in source:
            raise gl.vm.UserError("[EXPECTED] template must carry a pinned runner Depends header")
        if self.template_bytes > 0:
            raise gl.vm.UserError("[EXPECTED] template is already provisioned and this factory is frozen")
        self.org_template = source
        self.template_bytes = u256(len(source))
        self.template_provisioned_at = gl.message_raw["datetime"]
        self._log({"event": "template_provisioned", "bytes": len(source)})

    @gl.public.write
    def deploy_org(
        self,
        org_name: str,
        mission: str,
        charter: str,
        evidence_urls: str,
        operator: str,
    ) -> Address:
        name = str(org_name).strip()
        if name == "" or len(name) > 120:
            raise gl.vm.UserError("[EXPECTED] org_name must be between 1 and 120 characters")
        if name in self.orgs:
            raise gl.vm.UserError(f"[EXPECTED] a fideicommis named {name} already exists")
        if str(mission).strip() == "":
            raise gl.vm.UserError("[EXPECTED] mission must not be empty")
        if str(charter).strip() == "":
            raise gl.vm.UserError("[EXPECTED] charter must not be empty")
        if int(self.template_bytes) == 0:
            raise gl.vm.UserError("[EXPECTED] no template provisioned, call provision_template() first")

        index = int(self.org_count) + 1
        address = gl.deploy_contract(
            code=str(self.org_template).encode("utf-8"),
            args=[name, str(mission), str(charter), str(operator), str(evidence_urls)],
            salt_nonce=u256(index),
            on="finalized",
        )
        self.orgs[name] = OrgRecord(
            address=address,
            name=name,
            deployer=gl.message.sender_address,
            deployed_at=gl.message_raw["datetime"],
            index=u256(index),
            template_bytes=u256(self.template_bytes),
        )
        self.org_by_address[address] = name
        self.org_order.append(name)
        self.org_count = u256(index)
        self.template_deploy_count = u256(int(self.template_deploy_count) + 1)
        return address

    @gl.public.write
    def poke(self, org_name: str) -> None:
        """Ask a registered fideicommis to run a cycle. Permissionless."""
        if org_name not in self.orgs:
            raise gl.vm.UserError(f"[EXPECTED] unknown fideicommis {org_name}")
        record = self.orgs[org_name]
        FideicommisRef(record.address).emit(on="finalized").advance_cycle()

    @gl.public.view
    def get_org_count(self) -> u256:
        return u256(self.org_count)

    @gl.public.view
    def get_deployer(self) -> str:
        return str(self.deployer)

    @gl.public.view
    def get_template_status(self) -> str:
        return json.dumps({
            "provisioned": int(self.template_bytes) > 0,
            "bytes": int(self.template_bytes),
            "provisioned_at": str(self.template_provisioned_at),
            "deployed_from_template": int(self.template_deploy_count),
        }, sort_keys=True)

    @gl.public.view
    def get_org_address(self, org_name: str) -> str:
        return str(self._require_org(org_name))

    @gl.public.view
    def get_org_names(self) -> str:
        names = []
        for name in self.org_order:
            names.append(str(name))
        return json.dumps(names)

    @gl.public.view
    def get_registry(self) -> str:
        records = []
        for name in self.org_order:
            record = self.orgs[str(name)]
            records.append({
                "name": str(record.name),
                "address": str(record.address),
                "deployer": str(record.deployer),
                "deployed_at": str(record.deployed_at),
                "index": int(record.index),
                "template_bytes": int(record.template_bytes),
            })
        return json.dumps(records)

    @gl.public.view
    def get_org_status(self, org_name: str) -> str:
        return str(FideicommisRef(self._require_org(org_name)).view().get_status())

    @gl.public.view
    def get_org_treasury(self, org_name: str) -> u256:
        return u256(FideicommisRef(self._require_org(org_name)).view().get_treasury())

    @gl.public.view
    def get_org_runway(self, org_name: str) -> u256:
        return u256(FideicommisRef(self._require_org(org_name)).view().get_runway_cycles())

    @gl.public.view
    def get_org_summary(self, org_name: str) -> str:
        return str(FideicommisRef(self._require_org(org_name)).view().get_org_summary())

    def _require_deployer(self) -> None:
        if gl.message.sender_address != self.deployer:
            raise gl.vm.UserError("[EXPECTED] only the factory deployer may do this")

    def _require_org(self, org_name: str) -> Address:
        if org_name not in self.orgs:
            raise gl.vm.UserError(f"[EXPECTED] unknown fideicommis {org_name}")
        return self.orgs[org_name].address

    def _log(self, entry: dict) -> None:
        print(json.dumps(entry, sort_keys=True))
