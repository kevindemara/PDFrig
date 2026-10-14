"""Fixed-corpus EDIT-002 research verifier, never a customer-document endpoint."""
import json
import subprocess
import sys
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageChops, ImageDraw

source_path, output_path, original, replacement, bounds = sys.argv[1:]
source, output = [PdfReader(path, strict=True) for path in [source_path, output_path]]
text = output.pages[0].extract_text()
assert replacement in text and original not in text
assert len(source.pages) == len(output.pages)
assert [page.rotation for page in source.pages] == [page.rotation for page in output.pages]
assert [list(page.mediabox) for page in source.pages] == [list(page.mediabox) for page in output.pages]
assert [list(page.cropbox) for page in source.pages] == [list(page.cropbox) for page in output.pages]

def text_geometry(page, marker):
    records = []
    def capture(value, current_matrix, text_matrix, font, size):
        if marker in value:
            # A writer may move the same transform between cm and Tm. Compare
            # their effective product, not the choice of PDF operator spelling.
            a, b, c, d, e, f = text_matrix
            g, h, i, j, k, l = current_matrix
            effective = [a*g+b*i, a*h+b*j, c*g+d*i, c*h+d*j,
                         e*g+f*i+k, e*h+f*j+l]
            records.append({
                'font': str(font.get('/BaseFont')) if font else None,
                'subtype': str(font.get('/Subtype')) if font else None,
                'size': round(float(size), 6),
                'effectiveMatrix': [round(float(number), 6) for number in effective],
            })
    page.extract_text(visitor_text=capture)
    return records

original_geometry = text_geometry(source.pages[0], original)
edited_geometry = text_geometry(output.pages[0], replacement)
geometry_equal = len(original_geometry) == 1 and original_geometry == edited_geometry
outside_equal = True
for index in range(len(source.pages)):
    images = []
    for label, path in [('original', source_path), ('edited', output_path)]:
        prefix = str(Path(output_path).with_suffix('')) + f'-{index}-{label}'
        subprocess.run(['pdftoppm', '-f', str(index + 1), '-l', str(index + 1),
                        '-singlefile', '-r', '72', '-png', path, prefix],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        images.append(Image.open(prefix + '.png').convert('RGB'))
    if index == 0:
        left, bottom, right, top = json.loads(bounds)
        height = float(source.pages[0].mediabox.height)
        box = (int(left) - 4, int(height - top) - 4, int(right) + 4, int(height - bottom) + 4)
        for image in images:
            ImageDraw.Draw(image).rectangle(box, fill='white')
    outside_equal &= images[0].size == images[1].size and ImageChops.difference(*images).getbbox() is None
root_before, root_after = [reader.trailer['/Root'] for reader in [source, output]]
tags_present = '/StructTreeRoot' in root_before
actual_text_consistent = True
if tags_present:
    # This fixed fixture's first paragraph is /K[0], with explicit /ActualText.
    actual_text_consistent = str(root_after['/StructTreeRoot']['/K'][0].get_object().get('/ActualText')) == replacement
def outline_snapshot(reader, items):
    """Compare hierarchy, page identity and view geometry, not just titles."""
    result = []
    for item in items:
        if isinstance(item, list):
            result.append(outline_snapshot(reader, item))
        else:
            result.append({
                'title': str(item['/Title']),
                'page': reader.get_destination_page_number(item),
                'view': str(item.typ),
                'geometry': [None if getattr(item, key) is None else float(getattr(item, key))
                             for key in ['left', 'bottom', 'right', 'top', 'zoom']],
            })
    return result

bookmarks_equal = outline_snapshot(source, source.outline) == outline_snapshot(output, output.outline)
print(json.dumps({'sourceReplaced': True, 'outsidePixelsEqual': outside_equal,
                  'textGeometryRetained': geometry_equal,
                  'taggedActualTextConsistent': actual_text_consistent,
                  'bookmarksRetained': bookmarks_equal}))
