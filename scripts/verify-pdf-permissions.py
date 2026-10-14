"""SEC-003 independent strict-reader checks. Purpose-created fixture passwords only."""
import sys
from pypdf import PdfReader

source_path, output_path, printing, copying, modifying, annotating, filling, assembly, empty_open, mode = sys.argv[1:]
owner = "synthetic-owner-password"
open_password = "" if empty_open == "true" else "synthetic-open-password"
source = PdfReader(source_path, strict=True)
assert mode in ("protect", "permissions", "unlocked")
if mode == "unlocked":
    plain = PdfReader(output_path, strict=True)
    assert not plain.is_encrypted and plain.trailer.get("/Encrypt") is None
    assert dict(plain.metadata or {}) == dict(source.metadata or {})
    assert len(plain.pages) == len(source.pages)
    for before, after in zip(source.pages, plain.pages):
        for key in ["/MediaBox", "/CropBox", "/TrimBox", "/ArtBox", "/BleedBox", "/Rotate"]:
            assert after.get(key) == before.get(key)
        assert after.extract_text() == before.extract_text()
        bc, ac = before.get_contents(), after.get_contents()
        assert (bc.get_data() if bc else b"") == (ac.get_data() if ac else b"")
        assert len(after.get("/Annots", [])) == len(before.get("/Annots", []))
    assert list(plain.get_fields() or {}) == list(source.get_fields() or {})
    for name, field in (source.get_fields() or {}).items():
        assert plain.get_fields()[name].get("/V") == field.get("/V")
    print("SEC-002 strict independent reader: plaintext, metadata, pages, text, forms and streams verified.")
    sys.exit(0)
roles = [(open_password, 1)] if mode == "protect" else [(owner, 2), (open_password, 1)]
for password, expected_role in roles:
    output = PdfReader(output_path, strict=True)
    assert output.is_encrypted and output.decrypt(password) == expected_role
    encryption = output.trailer["/Encrypt"]
    assert encryption["/Filter"] == "/Standard"
    assert (encryption["/V"], encryption["/R"], encryption["/Length"]) == (5, 6, 256)
    for key in ["/StmF", "/StrF"]:
        assert encryption["/CF"][encryption[key]]["/CFM"] == "/AESV3"
    flags = int(encryption["/P"]) & 0xFFFFFFFF
    expected = {
        3: printing != "none", 4: modifying == "true", 5: copying == "true",
        6: annotating == "true", 9: filling == "true", 10: True,
        11: assembly == "true", 12: printing == "high",
    }
    for bit in range(1, 33):
        assert bool(flags & (1 << (bit - 1))) == expected.get(bit, bit not in (1, 2))
    assert dict(output.metadata or {}) == dict(source.metadata or {})
    assert len(output.pages) == len(source.pages)
    assert list(output.get_fields() or {}) == list(source.get_fields() or {})
    for name, field in (source.get_fields() or {}).items():
        assert output.get_fields()[name].get("/V") == field.get("/V")
    for before, after in zip(source.pages, output.pages):
        for key in ["/MediaBox", "/CropBox", "/TrimBox", "/ArtBox", "/BleedBox", "/Rotate"]:
            assert after.get(key) == before.get(key)
        assert after.extract_text() == before.extract_text()
        before_contents, after_contents = before.get_contents(), after.get_contents()
        assert (before_contents.get_data() if before_contents else b"") == (after_contents.get_data() if after_contents else b"")
        assert len(after.get("/Annots", [])) == len(before.get("/Annots", []))
    assert output.trailer["/Root"].get("/Names") is None
    assert output.trailer["/Root"].get("/OpenAction") is None
wrong = PdfReader(output_path, strict=True)
assert wrong.decrypt("synthetic-wrong-password") == 0
print("SEC-003 strict independent reader: roles, all bits, metadata, pages, text, forms and streams verified.")
