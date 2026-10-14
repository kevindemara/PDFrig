from pathlib import Path
import sys

from pypdf import PdfReader


def signature_field(path: Path):
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 1
    acroform = reader.trailer["/Root"]["/AcroForm"].get_object()
    fields = acroform["/Fields"]
    assert len(fields) == 1
    field = fields[0].get_object()
    assert field["/FT"] == "/Sig"
    assert field["/Subtype"] == "/Widget"
    return field


def signature_parent_widget(path: Path, action_location=None):
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 1
    acroform = reader.trailer["/Root"]["/AcroForm"].get_object()
    fields = acroform["/Fields"]
    assert len(fields) == 1
    parent_reference = fields[0]
    parent = parent_reference.get_object()
    assert parent["/FT"] == "/Sig"
    assert "/Subtype" not in parent
    assert "/V" not in parent
    if action_location == "parent":
        actions = parent["/AA"]
        assert set(actions.keys()) == {"/U"}
        action = actions["/U"]
        assert action["/S"] == "/JavaScript"
        assert "/JS" in action
    else:
        assert "/AA" not in parent
    kids = parent["/Kids"]
    assert len(kids) == 1
    widget_reference = kids[0]
    widget = widget_reference.get_object()
    assert widget["/Subtype"] == "/Widget"
    assert widget.raw_get("/Parent").idnum == parent_reference.idnum
    if action_location == "widget":
        actions = widget["/AA"]
        assert set(actions.keys()) == {"/U"}
        action = actions["/U"]
        assert action["/S"] == "/JavaScript"
        assert "/JS" in action
    else:
        assert "/AA" not in widget
    annotations = reader.pages[0].raw_get("/Annots")
    assert len(annotations) == 1
    assert annotations[0].idnum == widget_reference.idnum


def signature_field_action(path: Path):
    field = signature_field(path)
    assert "/V" not in field
    actions = field["/AA"]
    assert set(actions.keys()) == {"/U"}
    action = actions["/U"]
    assert action["/S"] == "/JavaScript"
    assert "/JS" in action


def signature_malformed_value(path: Path):
    field = signature_field(path)
    assert list(field["/V"]) == [1, 2, 3]
    assert "/AA" not in field


def signature_orphan_widget(path: Path):
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 1
    assert "/AcroForm" not in reader.trailer["/Root"]
    annotations = reader.pages[0].raw_get("/Annots")
    assert len(annotations) == 1
    widget = annotations[0].get_object()
    assert widget["/FT"] == "/Sig"
    assert widget["/Subtype"] == "/Widget"
    assert "/Parent" not in widget
    assert "/V" not in widget
    assert "/AA" not in widget


def signature_cross_page_action(path: Path):
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 2
    acroform = reader.trailer["/Root"]["/AcroForm"].get_object()
    fields = acroform["/Fields"]
    assert len(fields) == 1
    signature_reference = fields[0]
    signature = signature_reference.get_object()
    assert signature["/FT"] == "/Sig"
    assert signature["/Subtype"] == "/Widget"
    assert "/AA" not in signature
    first_annotations = reader.pages[0].raw_get("/Annots")
    assert len(first_annotations) == 1
    assert first_annotations[0].idnum == signature_reference.idnum
    second_annotations = reader.pages[1].raw_get("/Annots")
    assert len(second_annotations) == 1
    action_annotation = second_annotations[0].get_object()
    assert action_annotation["/Subtype"] == "/Link"
    actions = action_annotation["/AA"]
    assert set(actions.keys()) == {"/U"}
    action = actions["/U"]
    assert action["/S"] == "/JavaScript"
    assert "/JS" in action


def signature_with_text_field(path: Path, action=False):
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 1
    acroform = reader.trailer["/Root"]["/AcroForm"].get_object()
    fields = acroform["/Fields"]
    assert len(fields) == 2
    text_reference, signature_reference = fields
    text_field = text_reference.get_object()
    signature = signature_reference.get_object()
    assert text_field["/FT"] == "/Tx"
    assert text_field["/Subtype"] == "/Widget"
    assert text_field["/V"] == ""
    if action:
        actions = text_field["/AA"]
        assert set(actions.keys()) == {"/U"}
        text_action = actions["/U"]
        assert text_action["/S"] == "/JavaScript"
        assert "/JS" in text_action
    else:
        assert "/AA" not in text_field
    assert signature["/FT"] == "/Sig"
    assert signature["/Subtype"] == "/Widget"
    assert "/V" not in signature
    assert "/AA" not in signature
    annotations = reader.pages[0].raw_get("/Annots")
    assert len(annotations) == 2
    assert annotations[0].idnum == text_reference.idnum
    assert annotations[1].idnum == signature_reference.idnum


def signature_mixed_fields(path: Path):
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 1
    acroform = reader.trailer["/Root"]["/AcroForm"].get_object()
    fields = acroform["/Fields"]
    assert len(fields) == 2
    empty = fields[0].get_object()
    metadata = fields[1].get_object()
    assert empty["/FT"] == "/Sig"
    assert metadata["/FT"] == "/Sig"
    assert "/V" not in empty
    annotations = reader.pages[0].raw_get("/Annots")
    assert len(annotations) == 2
    assert annotations[0].idnum == fields[0].idnum
    assert annotations[1].idnum == fields[1].idnum
    return metadata


if len(sys.argv) != 15:
    raise SystemExit(
        "usage: verify-pdf-signature-fixtures.py EMPTY FIELD_ACTION MALFORMED_VALUE ORPHAN_WIDGET PARENT_ACTION CHILD_ACTION CROSS_PAGE_ACTION MIXED_FORM_FIELDS MIXED_FORM_ACTION "
        "PLACEHOLDER METADATA_PLACEHOLDER MIXED_FIELDS OUT_OF_BOUNDS "
        "PARENT_WIDGET"
    )

empty = signature_field(Path(sys.argv[1]))
signature_field_action(Path(sys.argv[2]))
signature_malformed_value(Path(sys.argv[3]))
signature_orphan_widget(Path(sys.argv[4]))
signature_parent_widget(Path(sys.argv[5]), action_location="parent")
signature_parent_widget(Path(sys.argv[6]), action_location="widget")
signature_cross_page_action(Path(sys.argv[7]))
signature_with_text_field(Path(sys.argv[8]))
signature_with_text_field(Path(sys.argv[9]), action=True)
placeholder = signature_field(Path(sys.argv[10]))
metadata_path = Path(sys.argv[11])
metadata = signature_field(metadata_path)
mixed_path = Path(sys.argv[12])
mixed = signature_mixed_fields(mixed_path)
out_of_bounds_path = Path(sys.argv[13])
out_of_bounds = signature_field(out_of_bounds_path)
signature_parent_widget(Path(sys.argv[14]))

assert "/V" not in empty
placeholder_value = placeholder["/V"].get_object()
assert placeholder_value["/Type"] == "/Sig"
assert len(placeholder_value["/ByteRange"]) == 4

metadata_value = metadata["/V"].get_object()
assert metadata_value["/Type"] == "/Sig"
assert metadata_value["/SubFilter"] == "/adbe.pkcs7.detached"
byte_range = [int(value) for value in metadata_value["/ByteRange"]]
assert len(byte_range) == 4
start, first_length, second_start, second_length = byte_range
assert start == 0
assert first_length > 0
assert start + first_length <= second_start
assert second_start + second_length == metadata_path.stat().st_size
assert len(metadata_value["/Contents"].original_bytes) > 0
metadata_bytes = metadata_path.read_bytes()
assert metadata_bytes[first_length:second_start] == b"<0102030405060708>"

mixed_value = mixed["/V"].get_object()
assert mixed_value["/Type"] == "/Sig"
assert mixed_value["/SubFilter"] == "/adbe.pkcs7.detached"
mixed_range = [int(value) for value in mixed_value["/ByteRange"]]
assert len(mixed_range) == 4
mixed_start, mixed_first_length, mixed_second_start, mixed_second_length = mixed_range
assert mixed_start == 0
assert mixed_first_length > 0
assert mixed_start + mixed_first_length <= mixed_second_start
assert mixed_second_start + mixed_second_length == mixed_path.stat().st_size
assert len(mixed_value["/Contents"].original_bytes) > 0
mixed_bytes = mixed_path.read_bytes()
assert mixed_bytes[mixed_first_length:mixed_second_start] == b"<0102030405060708>"

out_of_bounds_value = out_of_bounds["/V"].get_object()
assert out_of_bounds_value["/Type"] == "/Sig"
assert out_of_bounds_value["/SubFilter"] == "/adbe.pkcs7.detached"
out_of_bounds_range = [int(value) for value in out_of_bounds_value["/ByteRange"]]
assert len(out_of_bounds_range) == 4
out_start, out_first_length, out_second_start, out_second_length = out_of_bounds_range
assert out_start == 0
assert out_first_length > 0
assert out_start + out_first_length <= out_second_start
assert out_second_start + out_second_length > out_of_bounds_path.stat().st_size
assert len(out_of_bounds_value["/Contents"].original_bytes) > 0

print(
    "Independent empty, direct-action, malformed-value, orphan-widget, parent-action, child-action, cross-page-action, mixed-form, mixed-form-action, field-only, metadata-placeholder, "
    "mixed-precedence, and out-of-bounds signature verification passed, "
    "including the parent/widget hierarchy."
)
