"""No-float invariant for the Intelligent Contracts.

GenVM emulates floats in software. Rounding behaviour is therefore not
something a consensus rule may depend on, and a stray `/` silently turns an
integer calculation into a float one that can crash the VM or make leader and
validators disagree on the same input.

Three rules are enforced here, for every file in `contracts/`:

1. No `ast.Div` node. Every division must be `ast.FloorDiv`.
2. No float literal and no `float(...)` call, so no float can be produced.
3. The builtin name `float` may only appear as the type argument of an
   `isinstance` check, which is the defensive code that *removes* floats rather
   than creating them.

Division by zero is checked too: it is the other way an integer calculation can
take the VM down.

Run with `python -m pytest tests/test_no_float.py -v`.
"""

import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
SOURCES = sorted(CONTRACTS.glob("*.py"))

# Denominators that are not literals. Each one must be guarded against zero in
# the method that uses it, which test_variable_division_denominators asserts.
VARIABLE_DIVIDENDS = {"burn", "total", "treasury"}


def _tree(path: Path) -> ast.AST:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _label(path: Path) -> str:
    return path.name


def _float_divisions(path: Path) -> list:
    return [
        f"line {node.lineno}"
        for node in ast.walk(_tree(path))
        if isinstance(node, ast.Div)
    ]


def _floor_divisions(path: Path) -> list:
    return [
        node
        for node in ast.walk(_tree(path))
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.FloorDiv)
    ]


def _divisor_of(node: ast.BinOp) -> str:
    return ast.unparse(node.right).strip()


@pytest.mark.parametrize("path", SOURCES, ids=_label)
def test_no_float_division_operator(path: Path):
    """`/` is banned outright. Integer division must be spelled `//`."""
    offenders = _float_divisions(path)
    assert not offenders, (
        f"{path.name} uses true division on line(s) {', '.join(offenders)}; "
        "use integer division // so the result stays an integer"
    )


@pytest.mark.parametrize("path", SOURCES, ids=_label)
def test_no_float_literals_or_calls(path: Path):
    """No float literal and no float() call, so no float can be produced."""
    offenders = []
    for node in ast.walk(_tree(path)):
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            offenders.append(f"line {node.lineno}: float literal {node.value!r}")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "float":
            offenders.append(f"line {node.lineno}: float() call")
    assert not offenders, f"{path.name} produces floats:\n" + "\n".join(offenders)


@pytest.mark.parametrize("path", SOURCES, ids=_label)
def test_float_is_only_ever_a_type_guard(path: Path):
    """`float` may only appear inside isinstance(), never as a value."""
    allowed = set()
    for node in ast.walk(_tree(path)):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "isinstance"
            and len(node.args) == 2
        ):
            for arg in node.args[1:]:
                for inner in ast.walk(arg):
                    if isinstance(inner, ast.Name) and inner.id == "float":
                        allowed.add(inner.lineno)

    offenders = []
    for node in ast.walk(_tree(path)):
        if isinstance(node, ast.Name) and node.id == "float" and node.lineno not in allowed:
            offenders.append(f"line {node.lineno}")
    assert not offenders, (
        f"{path.name} references the builtin float outside a type guard on line(s) "
        f"{', '.join(offenders)}"
    )


@pytest.mark.parametrize("path", SOURCES, ids=_label)
def test_divisions_are_inventory_stable(path: Path):
    """Pin the set of division sites so a reviewer can audit them all at once."""
    rendered = sorted(ast.unparse(node) for node in _floor_divisions(path))
    if path.name == "fideicommis.py":
        assert rendered == [
            "amount * 10000 // treasury",
            "approved_shares * 10000 // total",
            "budget * score // 100",
            "confidence // 20",
            "int(mine['amount_atto']) * 12 // 10",
            "int(mine['score']) // 20",
            "int(self.treasury) * int(self.spend_ceiling_bps) // 10000",
            "int(self.treasury) // burn",
            "int(theirs['score']) // 20",
            "share_bps // 100",
        ]
    else:
        assert rendered == [], f"{path.name} has no division, but {rendered}"


@pytest.mark.parametrize("path", SOURCES, ids=_label)
def test_variable_division_denominators_are_known(path: Path):
    """Only literal and reviewed denominators may appear."""
    for node in _floor_divisions(path):
        divisor = _divisor_of(node)
        if divisor.isdigit() or divisor in VARIABLE_DIVIDENDS:
            continue
        raise AssertionError(
            f"{path.name} line {node.lineno} divides by unreviewed expression {divisor!r}"
        )


def test_variable_division_denominators_are_guarded():
    """The two variable denominators must be guarded before the division."""
    source = (CONTRACTS / "fideicommis.py").read_text(encoding="utf-8")
    assert "if burn <= 0:" in source, "_runway_cycles must guard a zero burn"
    assert "if total <= 0:" in source, "_quorum_met must guard a zero total share"
    assert "if treasury > 0:" in source, "the assessment prompt must guard a zero treasury"


def test_payout_never_produces_a_float():
    """Settlement is the one place a division directly moves money."""
    source = (CONTRACTS / "fideicommis.py").read_text(encoding="utf-8")
    assert "(budget * score) // 100" in source
    assert "budget * score / 100" not in source
