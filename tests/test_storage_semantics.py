"""Regression tests for the GenVM storage behaviours Fideicommis relies on.

These are not tests of the fideicommis itself. They pin down SDK semantics that
silently change proposal bookkeeping if a runner upgrade alters them.
"""

import json

PATH = "contracts/storage_semantics.py"


def test_nested_dynarray_accepts_a_plain_list(direct_deploy):
    c = direct_deploy(PATH)
    c.assign_plain_list()
    assert json.loads(c.read_nested("p1"))["values"] == ["R1", "R2"]


def test_nested_dynarray_supports_append(direct_deploy):
    c = direct_deploy(PATH)
    c.assign_plain_list()
    c.append_to_nested()
    assert json.loads(c.read_nested("p1"))["values"] == ["R1", "R2", "R3"]


def test_missing_nested_key_is_absent_not_an_error(direct_deploy):
    c = direct_deploy(PATH)
    c.assign_plain_list()
    assert json.loads(c.read_nested("p404")) == {"values": [], "name": "none"}


def test_tremap_get_falls_back_to_the_default(direct_deploy):
    c = direct_deploy(PATH)
    assert json.loads(c.read_nested("p1"))["name"] == "none"


def test_inmem_allocate_of_dynarray_needs_an_empty_list(direct_deploy):
    c = direct_deploy(PATH)
    c.allocate_dynarray_with_empty_list()
    assert json.loads(c.read_top_level()) == []
