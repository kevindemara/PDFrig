"""ORG-011/ORG-012: independent synthetic numbering semantics and preservation."""

import json
import sys
from pathlib import Path

from pypdf import PdfReader

for case in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")):
    before = PdfReader(case["source"])
    after = PdfReader(case["output"])
    assert len(before.pages) == len(after.pages) == case["pages"]
    expected_identifiers = []
    for page_number, (original, result) in enumerate(zip(before.pages, after.pages), 1):
        assert list(original.mediabox) == list(result.mediabox)
        assert list(original.cropbox) == list(result.cropbox)
        assert original.rotation == result.rotation
        original_text = original.extract_text() or ""
        result_text = result.extract_text() or ""
        assert all(line in result_text for line in original_text.splitlines() if line.strip())
        if page_number < case["startPage"]:
            assert result.get_contents().get_data() == original.get_contents().get_data()
            expected_identifiers.append(str(page_number))
            continue
        sequence = 37 + page_number - case["startPage"]
        if "expectedIdentifiers" in case:
            identifier = case["expectedIdentifiers"][page_number - 1]
        else:
            identifier = (
                f"QA-AVAV-{sequence:06d}-gyp"
                if case["kind"] == "bates"
                else f"QA-AVAV-{sequence}"
            )
        assert identifier in result_text
        # Literal Tj text must retain spaces too, not just the extraction reader's layout guess.
        assert any(
            operator == b"Tj" and str(operands[0]) == identifier
            for operands, operator in result.get_contents().operations
        )
        assert b"/Artifact BMC" in result.get_contents().get_data()
        expected_identifiers.append(identifier)
    if case["kind"] == "page-labels":
        assert after.page_labels == expected_identifiers, case["name"]
    else:
        assert after.page_labels == before.page_labels
    original_fields = before.get_fields() or {}
    result_fields = after.get_fields() or {}
    assert original_fields.keys() == result_fields.keys()
    for name, field in original_fields.items():
        assert field.get("/V") == result_fields[name].get("/V")
    report = case["report"]
    assert report["appliedPages"] == case["pages"] - case["startPage"] + 1
    assert report["firstIdentifier"] == expected_identifiers[case["startPage"] - 1]
    assert report["lastIdentifier"] == expected_identifiers[-1]
    assert report["operationVersion"] == "1.0.3"

print("pypdf verified numbering labels, identifiers, reports, page geometry, forms, and unchanged pages.")
