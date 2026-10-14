import sys

from pypdf import PdfReader


reader = PdfReader(sys.argv[1], strict=True)
assert len(reader.pages) == 3

outline = reader.outline
assert len(outline) == 3
overview, children, final_page = outline
assert overview["/Title"] == "Overview"
assert reader.get_destination_page_number(overview) == 0
assert isinstance(children, list) and len(children) == 4
assert children[0]["/Title"] == "Chapitre 二 — 安全"
assert reader.get_destination_page_number(children[0]) == 1
assert children[1]["/Title"] == "External action is never followed"
assert reader.get_destination_page_number(children[1]) is None
assert children[2]["/Title"] == "Missing destination"
assert reader.get_destination_page_number(children[2]) is None
assert children[3]["/Title"].startswith("Long synthetic bookmark ")
assert len(children[3]["/Title"]) > 200
assert reader.get_destination_page_number(children[3]) == 1
assert final_page["/Title"] == "Final page"
assert reader.get_destination_page_number(final_page) == 2
assert set(reader.named_destinations) == {"chapter-two"}
assert reader.get_destination_page_number(reader.named_destinations["chapter-two"]) == 1

root = reader.trailer["/Root"]
overview_object = root["/Outlines"]["/First"].get_object()
action_object = overview_object["/First"]["/Next"].get_object()
assert "/Dest" not in action_object
assert action_object["/A"]["/S"] == "/URI"
assert str(action_object["/A"]["/URI"]) == "https://example.invalid/outline-action-must-not-open"

print("Independent outline structure verification passed.")
