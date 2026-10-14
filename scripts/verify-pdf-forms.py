"""Independent structural checks for synthetic Milestone 2 PDF outputs."""

from pathlib import Path
import sys

from pypdf import PdfReader


def fail(message: str) -> None:
    raise SystemExit(message)


def field_value(fields: dict, name: str):
    field = fields.get(name)
    if field is None:
        fail(f"Interactive output is missing {name}.")
    return field.get("/V")


annotated_path, interactive_path, flattened_path = map(Path, sys.argv[1:4])

annotated = PdfReader(annotated_path)
annotated_text = "\n".join(page.extract_text() or "" for page in annotated.pages)
for expected in ("Reviewed locally", "Synthetic Signer", "QA PASSED"):
    if expected not in annotated_text:
        fail(f"Independent parser could not extract the flattened overlay {expected!r}.")

interactive = PdfReader(interactive_path, strict=True)
fields = interactive.get_fields() or {}
if str(field_value(fields, "synthetic.name")).lstrip("/") != "Fixture Reviewer":
    fail("Interactive text value did not persist.")
radio_field = fields.get("synthetic.choice")
if radio_field is None:
    fail("Interactive output is missing synthetic.choice.")
radio_value = str(radio_field.get("/V")).lstrip("/")
radio_options = radio_field.get("/Opt", [])
if radio_value.isdigit() and int(radio_value) < len(radio_options):
    radio_value = str(radio_options[int(radio_value)]).lstrip("/")
if radio_value != "B":
    fail(f"Interactive radio value did not persist (found {radio_value!r}).")
if str(field_value(fields, "synthetic.province")).lstrip("/") != "QC":
    fail("Interactive dropdown value did not persist.")
if str(field_value(fields, "synthetic.approved")) in ("/Off", "False", "None"):
    fail("Interactive checkbox value did not persist.")

expected_values = {name: field_value(fields, name) for name in (
    "synthetic.name", "synthetic.approved", "synthetic.choice", "synthetic.province"
)}
choice_options = [(str(option[0]), str(option[1])) if isinstance(option, list)
                  else (str(option), str(option)) for option in fields["synthetic.province"]["/Opt"]]
assert choice_options == [("ON", "ON"), ("QC", "QC"), ("BC", "BC")], "Choice options changed"
tree_references = set()
def walk_fields(references):
    for reference in references:
        identity = (reference.idnum, reference.generation)
        assert identity not in tree_references, "Repeated or cyclic field reference"
        tree_references.add(identity)
        field = reference.get_object()
        for child in field.get("/Kids", []):
            assert child.get_object().get("/Parent") == reference, "Field parent mismatch"
        walk_fields(field.get("/Kids", []))
walk_fields(interactive.trailer["/Root"]["/AcroForm"]["/Fields"])

widget_count = 0
selected_radio_count = 0
for page in interactive.pages:
    for annotation_reference in page.get("/Annots", []):
        annotation = annotation_reference.get_object()
        if annotation.get("/Subtype") == "/Widget":
            widget_count += 1
            assert (annotation_reference.idnum, annotation_reference.generation) in tree_references, "Orphan widget"
            owner = annotation
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
            assert name in expected_values and effective_value == expected_values[name], "Widget value mismatch"
            appearance = annotation.get("/AP")
            if appearance is None or appearance.get("/N") is None:
                fail("An interactive widget is missing a normal appearance stream.")
            normal = appearance["/N"].get_object()
            if hasattr(normal, "get_data"):
                assert normal.get_data(), "Empty appearance stream"
            else:
                assert all(stream.get_object().get_data() for stream in normal.values()), "Empty button appearance"
                assert annotation.get("/AS") in normal, "Button appearance state is missing"
                if name == "synthetic.approved":
                    assert annotation["/AS"] == effective_value, "Checkbox appearance disagrees with value"
                if name == "synthetic.choice" and annotation.get("/AS") != "/Off":
                    selected_radio_count += 1
                    assert annotation["/AS"] == effective_value, "Radio appearance disagrees with value"
assert widget_count == 5 and selected_radio_count == 1, "Unexpected widget selection"

flattened = PdfReader(flattened_path, strict=True)
if flattened.get_fields():
    fail("Flattened output still exposes an AcroForm field tree.")
for page in flattened.pages:
    for annotation_reference in page.get("/Annots", []):
        if annotation_reference.get_object().get("/Subtype") == "/Widget":
            fail("Flattened output still contains a widget annotation.")
flattened_text = "\n".join(page.extract_text() or "" for page in flattened.pages)
for expected in ("Fixture Reviewer", "QC"):
    if expected not in flattened_text:
        fail(f"Independent parser could not extract flattened form value {expected!r}.")

print(
    "Independent pypdf verification passed for flattened overlays, interactive values, "
    "widget appearances, and explicit form flattening."
)
