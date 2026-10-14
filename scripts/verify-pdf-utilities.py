from __future__ import annotations

import sys
from zipfile import ZipFile

from pypdf import PdfReader


(
    compressed_path,
    decorated_path,
    page_labels_path,
    bates_path,
    cropped_path,
    resized_path,
    protected_path,
    unlocked_path,
    metadata_path,
    images_path,
    images_archive_path,
    blank_path,
    password,
) = sys.argv[1:]

compressed = PdfReader(compressed_path)
assert len(compressed.pages) == 1

decorated = PdfReader(decorated_path)
assert not decorated.is_encrypted
assert len(decorated.pages) == 3
decorated_text = "\n".join(page.extract_text() or "" for page in decorated.pages)
assert "Synthetic review copy" in decorated_text
assert "Page 1 of 3" in decorated_text
assert "Page 3 of 3" in decorated_text
assert "INTERNAL" in decorated_text
for page in decorated.pages:
    contents = page.get_contents()
    assert contents is not None
    assert b"/Artifact BMC" in contents.get_data()

page_labels = PdfReader(page_labels_path)
assert page_labels.page_labels == ["SEC-i", "SEC-ii", "SEC-iii"]
for index, page in enumerate(page_labels.pages, start=1):
    assert f"SEC-{('i', 'ii', 'iii')[index - 1]}" in (page.extract_text() or "")
    contents = page.get_contents()
    assert contents is not None
    assert b"/Artifact BMC" in contents.get_data()

bates = PdfReader(bates_path)
assert bates.page_labels == page_labels.page_labels
for index, page in enumerate(bates.pages, start=42):
    assert f"CASE-{index:06d}" in (page.extract_text() or "")
    contents = page.get_contents()
    assert contents is not None
    assert contents.get_data().count(b"/Artifact BMC") >= 2

cropped = PdfReader(cropped_path)
assert len(cropped.pages) == 3
for page in cropped.pages:
    assert tuple(float(value) for value in page.mediabox) == (0.0, 0.0, 612.0, 792.0)
    assert tuple(float(value) for value in page.cropbox) == (36.0, 30.0, 588.0, 774.0)
    assert "Synthetic page" in (page.extract_text() or "")

resized = PdfReader(resized_path)
assert len(resized.pages) == 3
for page in resized.pages:
    media_box = tuple(float(value) for value in page.mediabox)
    crop_box = tuple(float(value) for value in page.cropbox)
    assert all(abs(left - right) < 0.02 for left, right in zip(media_box, (0, 0, 841.89, 595.28)))
    assert all(abs(left - right) < 0.02 for left, right in zip(crop_box, media_box))
    assert "Synthetic page" in (page.extract_text() or "")

protected = PdfReader(protected_path)
assert protected.is_encrypted
assert protected.decrypt(password) > 0
assert len(protected.pages) == 1

unlocked = PdfReader(unlocked_path)
assert not unlocked.is_encrypted
assert len(unlocked.pages) == 1

metadata = PdfReader(metadata_path).metadata
assert metadata is not None
assert metadata.title == "Synthetic utility output"
assert metadata.author == "PDFMason synthetic verification"
assert metadata.subject == "Milestone 4 utility fixture"

images = PdfReader(images_path)
assert not images.is_encrypted
assert len(images.pages) == 2

blank = PdfReader(blank_path, strict=True)
assert not blank.is_encrypted
assert len(blank.pages) == 3
for blank_page in blank.pages:
    media_box = tuple(float(value) for value in blank_page.mediabox)
    crop_box = tuple(float(value) for value in blank_page.cropbox)
    art_box = tuple(float(value) for value in blank_page.artbox)
    assert all(abs(left - right) < 0.02 for left, right in zip(media_box, (0, 0, 841.89, 595.28)))
    assert all(abs(left - right) < 0.02 for left, right in zip(crop_box, media_box))
    assert all(abs(left - right) < 0.02 for left, right in zip(art_box, (72, 72, 769.89, 523.28)))
    assert blank_page.get_contents() is None
    assert (blank_page.extract_text() or "") == ""
    assert "/Annots" not in blank_page

with ZipFile(images_archive_path) as images_archive:
    assert images_archive.namelist() == ["page-001.png", "page-002.png"]
    assert images_archive.read("page-001.png").startswith(b"\x89PNG")

print(
    "pypdf independently reopened and inspected every utility, decoration, numbering, and page-geometry output."
)
