# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Fixture contract for tests/test_storage_semantics.py.

It encodes the storage behaviours that Fideicommis depends on, so a GenVM
SDK upgrade that changes them fails loudly here instead of silently corrupting
proposal records.
"""

from genlayer import *
import json


@allow_storage
class StorageSemantics(gl.Contract):
    nested: TreeMap[str, DynArray[str]]
    names: TreeMap[str, str]
    box_items: DynArray[str]

    def __init__(self) -> None:
        pass

    @gl.public.write
    def assign_plain_list(self) -> None:
        self.nested["p1"] = ["R1", "R2"]
        self.names["p1"] = "first"

    @gl.public.write
    def append_to_nested(self) -> None:
        self.nested["p1"].append("R3")

    @gl.public.write
    def allocate_dynarray_with_empty_list(self) -> None:
        self.box_items = gl.storage.inmem_allocate(DynArray[str], [])

    @gl.public.view
    def read_nested(self, key: str) -> str:
        values = []
        if key in self.nested:
            for value in self.nested[key]:
                values.append(str(value))
        return json.dumps({
            "values": values,
            "name": str(self.names.get(key, "none")),
        }, sort_keys=True)

    @gl.public.view
    def read_top_level(self) -> str:
        values = []
        for value in self.box_items:
            values.append(str(value))
        return json.dumps(values)
