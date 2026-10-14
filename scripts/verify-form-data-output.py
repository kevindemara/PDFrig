"""FORM-003: independent verifier for synthetic test output only; never print values."""
import sys
from pypdf import PdfReader

reader = PdfReader(sys.argv[1], strict=True)
cleared = len(sys.argv) == 3 and sys.argv[2] == "--cleared"
fields = reader.get_fields()
expected = {
    "synthetic.name": "Form Data Reviewer",
    "synthetic.approved": "/Off" if cleared else "/Yes",
    "synthetic.choice": "/Off" if cleared else "/1",
    "synthetic.province": None if cleared else "QC",
}
assert fields is not None
assert {name for name, field in fields.items() if field.get("/FT")} == set(expected)
assert fields["synthetic.choice"]["/Opt"][1] == "B"
for name, value in expected.items():
    assert fields[name].get("/V") == value, "Canonical field value mismatch"

widgets = []
for page in reader.pages:
    for reference in page.get("/Annots", []):
        widget = reference.get_object()
        if widget.get("/Subtype") != "/Widget":
            continue
        widgets.append(widget)
        owner = widget
        names = []
        effective_value = None
        while True:
            if "/T" in owner:
                names.insert(0, str(owner["/T"]))
            if effective_value is None and "/V" in owner:
                effective_value = owner["/V"]
            if "/Parent" not in owner:
                break
            owner = owner["/Parent"].get_object()
        name = ".".join(names)
        assert name in expected
        assert effective_value == expected[name], "Widget value mismatch"
        normal = widget["/AP"]["/N"].get_object()
        if hasattr(normal, "get_data"):
            assert normal.get_data(), "Empty appearance stream"
        else:
            assert normal, "Empty appearance dictionary"
            for stream in normal.values():
                assert stream.get_object().get_data(), "Empty choice appearance"
assert len(widgets) == 5, "Unexpected widget count"
assert sum(widget.get("/AS") == "/1" for widget in widgets) == (0 if cleared else 1)
if cleared:
    assert all(widget.get("/AS") in (None, "/Off") for widget in widgets)
print("FORM-003 canonical fields, widgets and appearances verified")
