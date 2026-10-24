"""Independent, read-only ZIP/hash check for the pinned portable Windows payload."""
import hashlib
import json
from pathlib import Path
import argparse
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('archive', type=Path)
parser.add_argument('--extracted', type=Path)
parser.add_argument('--pin', type=Path, help='Explicit local source-build pin; old installer is the default')
args = parser.parse_args()
archive = args.archive
if args.pin:
    pin = json.loads(args.pin.read_text())
    assert pin['id'] == 'local-portable-20261024-tables-ocr'
    assert pin['localBuild']['publicReleaseApproved'] is False
    snapshot = json.loads(args.pin.with_name('source-manifest.json').read_text())
    assert snapshot['sha256'] == pin['localBuild']['sourceSnapshotSha256']
    assert hashlib.sha256(json.dumps(snapshot['entries'], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest() == snapshot['sha256']
else:
    audit = json.loads((root / "docs/dependencies/windows-installer-dependency-audit.json").read_text())
    pin = next(item for item in audit["artifacts"] if item["id"] == "private-test-20261020-2")
inputs = {
    "PDFrig.exe": "pdfmason-desktop.exe",
    "licenses/PDFrig-LICENSE.txt": "licenses/PDFrig-LICENSE.txt",
    "licenses/THIRD_PARTY_NOTICES.txt": "licenses/THIRD_PARTY_NOTICES.txt",
    "licenses/UPSTREAM-LICENSE-TEXTS.txt": "licenses/UPSTREAM-LICENSE-TEXTS.txt",
}
expected = set(inputs) | {"READ_FIRST.txt", "BUILD_INFO.json", "SHA256SUMS.txt"}
assert archive.stat().st_size < 64 * 1024 * 1024
with ZipFile(archive) as package:
    names = package.namelist()
    assert len(names) == len(set(names)), "Duplicate ZIP paths"
    assert {name for name in names if not name.endswith("/")} == {"PDFrig/" + name for name in expected}
    assert all(name in {"PDFrig/", "PDFrig/licenses/"} for name in names if name.endswith("/"))
    assert all(not item.flag_bits & 1 and (item.external_attr >> 16) & 0o170000 != 0o120000 for item in package.infolist()), "Encrypted or linked member"
    for name in expected:
        assert package.getinfo("PDFrig/" + name).file_size < 64 * 1024 * 1024
    for name, original in inputs.items():
        source = next(item for item in pin["payload"] if item["path"] == original)
        assert package.getinfo("PDFrig/" + name).file_size == source["bytes"]
        assert hashlib.sha256(package.read("PDFrig/" + name)).hexdigest() == source["sha256"], name
    for name in ["READ_FIRST.txt", "BUILD_INFO.json", "SHA256SUMS.txt"]:
        assert package.getinfo("PDFrig/" + name).file_size < 16_384
    checksums = package.read("PDFrig/SHA256SUMS.txt").decode().splitlines()
    assert len(checksums) == 6
    listed = []
    for line in checksums:
        digest, name = line.split("  ", 1)
        assert name in expected - {"SHA256SUMS.txt"}
        assert digest == hashlib.sha256(package.read("PDFrig/" + name)).hexdigest()
        listed.append(name)
    assert set(listed) == expected - {"SHA256SUMS.txt"}
    info = json.loads(package.read("PDFrig/BUILD_INFO.json"))
    assert info["sourceCommit"] == pin["installer"]["sourceCommit"]
    assert info["installerSha256"] == pin["installer"].get("sha256")
    assert info["executable"]["sha256"] == hashlib.sha256(package.read("PDFrig/PDFrig.exe")).hexdigest()
    assert info["rebuilt"] == bool(args.pin)
    assert not info["publicReleaseApproved"] and info["manualAcceptancePending"]
    if args.pin:
        assert info['sourceSnapshotSha256'] == pin['localBuild']['sourceSnapshotSha256']
        assert info['features'] == {'tables': True, 'ocr': True, 'xlsx': True, 'ods': True}
        assert not info['installerAndPortableShareSettings']
        assert 'SheetJS' in package.read('PDFrig/licenses/UPSTREAM-LICENSE-TEXTS.txt').decode()
    assert package.testzip() is None
    if args.extracted:
        extracted = args.extracted.resolve(strict=True)
        files = list(extracted.rglob("*"))
        assert not any(item.is_symlink() for item in files), "Linked extracted member"
        assert {item.relative_to(extracted).as_posix() for item in files if item.is_file()} == expected
        for name in expected:
            assert (extracted / name).read_bytes() == package.read("PDFrig/" + name), name
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
if args.pin:
    assert digest == pin['zip']['sha256']
    assert archive.stat().st_size == pin['zip']['bytes']
assert archive.with_name("SHA256SUMS.txt").read_text().strip() == digest + "  " + archive.name
print("Portable ZIP: exact executable, three notices, seven-file allowlist, CRCs, provenance and all checksums verified.")
