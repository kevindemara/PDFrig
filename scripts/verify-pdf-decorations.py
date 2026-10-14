from __future__ import annotations

import json
import sys
from pathlib import Path

from pypdf import PdfReader


def content(page):
    stream = page.get_contents()
    return b"" if stream is None else stream.get_data()


for case in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")):
    before = PdfReader(case["source"])
    after = PdfReader(case["output"])
    assert not after.is_encrypted
    assert len(before.pages) == len(after.pages) == case["pages"]
    before_fields = before.get_fields() or {}
    after_fields = after.get_fields() or {}
    assert before_fields.keys() == after_fields.keys()
    for name, field in before_fields.items():
        assert field.get("/V") == after_fields[name].get("/V")
        assert field.get("/FT") == after_fields[name].get("/FT")
    for index, (source, output) in enumerate(zip(before.pages, after.pages), start=1):
        assert tuple(source.mediabox) == tuple(output.mediabox)
        assert tuple(source.cropbox) == tuple(output.cropbox)
        assert source.rotation == output.rotation
        text = output.extract_text() or ""
        for line in (source.extract_text() or "").splitlines():
            assert line in text, f"Original text lost: {case['name']} page {index}"
        if index in case["selected"]:
            assert f"HEADER {index}/{case['pages']}" in text
            assert f"FOOTER {index}/{case['pages']}" in text
            assert content(output).count(b"/Artifact BMC") >= 2
        else:
            assert "HEADER" not in text and "FOOTER" not in text
            assert content(source) == content(output)

print("pypdf verified page counts, boxes, rotations, original text, page tokens, artifacts, unchanged streams, and form values.")
