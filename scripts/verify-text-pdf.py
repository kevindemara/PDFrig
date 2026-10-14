"""CONV-005 independent strict-reader verification of the fixed CC0 text fixture."""
import hashlib
import json
import math
import pathlib
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

output, source, size = sys.argv[1:]
source_path = pathlib.Path(source)
manifest = json.loads(source_path.with_name('plain-text-ascii.manifest.json').read_text())
source_bytes = source_path.read_bytes()
assert hashlib.sha256(source_bytes).hexdigest() == manifest['sha256']
text = source_bytes.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
width, height = (595.28, 841.89) if size == 'a4' else (612, 792)
columns = math.floor((width - 72) / 7.2)
rows = math.floor((height - 84) / 15) + 1
lines = []
for line in text.split('\n'):
    expanded = line.expandtabs(4)
    lines.extend([expanded[i:i + columns] for i in range(0, len(expanded), columns)] or [''])
expected_pages = [lines[i:i + rows] for i in range(0, len(lines), rows)]
reader = PdfReader(output, strict=True)
assert not reader.is_encrypted
assert len(reader.pages) == len(expected_pages) == 2
root = reader.trailer['/Root']
assert all(key not in root for key in ('/AcroForm', '/StructTreeRoot', '/Names', '/OpenAction', '/AA', '/Metadata'))
assert not reader.metadata or all(key not in reader.metadata for key in ('/CreationDate', '/ModDate', '/Title', '/Author'))
for page, expected in zip(reader.pages, expected_pages):
    assert all(abs(float(a) - b) < .01 for a, b in zip(page.mediabox, (0, 0, width, height)))
    assert page.cropbox == page.mediabox and page.get('/Rotate', 0) == 0
    assert not page.get('/Annots')
    contents = ContentStream(page.get_contents(), reader)
    actual = [str(operands[0]) for operands, operator in contents.operations if operator == b'Tj']
    assert actual == [line for line in expected if line != ''], 'text/space/wrap mismatch'
    positions = [operands for operands, operator in contents.operations if operator == b'Tm']
    assert len(positions) == len(actual)
    for position, index in zip(positions, [i for i, line in enumerate(expected) if line != '']):
        assert float(position[4]) == 36
        assert abs(float(position[5]) - (height - 48 - index * 15)) < .01
    fonts = page['/Resources']['/Font']
    assert all(font.get_object()['/BaseFont'] == '/Courier' for font in fonts.values())
assert all(sum((page.extract_text() or '').count(f'Row {number:02}') for page in reader.pages) == 1 for number in range(1, 61))
print('CONV-005 independent structure, every text row/space and placement verified')
