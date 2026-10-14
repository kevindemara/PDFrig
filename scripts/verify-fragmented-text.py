"""Fixed synthetic selection test: unchanged surroundings and original font/placement."""
import json, subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageChops, ImageDraw
source_path, output_path = sys.argv[1:]
ns = {'x': 'http://www.w3.org/1999/xhtml'}
def lines(path):
    result = subprocess.run(['pdftotext', '-bbox-layout', path, '-'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    return ET.fromstring(result.stdout).findall('.//x:line', ns)
source_lines, output_lines = lines(source_path), lines(output_path)
def words(line): return line.findall('x:word', ns)
def text(line): return ' '.join(word.text or '' for word in words(line))
assert any(text(line) == 'FIRST SOURCE AFTER' for line in output_lines)
edited_row = sorted([word for line in output_lines for word in words(line) if abs(float(word.attrib['yMin'])-(792-480-18*0.718)) < 4], key=lambda word: float(word.attrib['xMin']))
assert ' '.join(word.text or '' for word in edited_row) == 'SECOND EDIT AFTER'
assert any(text(line) == 'ARRAY WORDS AFTER' for line in output_lines)
target = next(word for line in source_lines if text(line) == 'SECOND SOURCE AFTER' for word in words(line) if word.text == 'SOURCE')
box = tuple(float(target.attrib[key]) for key in ['xMin', 'yMin', 'xMax', 'yMax'])
edited_word = next(word for word in edited_row if word.text == 'EDIT')
assert abs(float(edited_word.attrib['xMin'])-box[0]) < 0.01
assert abs(float(edited_word.attrib['yMin'])-box[1]) < 0.01
readers = [PdfReader(path, strict=True) for path in [source_path, output_path]]
records = []
for reader in readers:
    current = []
    def capture(value, cm, tm, font, size):
        if value.strip().startswith('SECOND '):
            x, y = tm[4]*cm[0]+tm[5]*cm[2]+cm[4], tm[4]*cm[1]+tm[5]*cm[3]+cm[5]
            if abs(x-54) < 0.1 and abs(y-480) < 0.1:
                current.append([str(font.get('/BaseFont')), round(float(size), 6), round(x, 5), round(y, 5)])
    reader.pages[0].extract_text(visitor_text=capture)
    records.append(current)
assert len(records[0]) == 1 and records[0] == records[1]
images = []
for index, path in enumerate([source_path, output_path]):
    prefix = str(Path(output_path).with_suffix('')) + f'-{index}'
    subprocess.run(['pdftoppm', '-singlefile', '-r', '144', '-png', path, prefix], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    image = Image.open(prefix+'.png').convert('RGB')
    ImageDraw.Draw(image).rectangle((int(box[0]*2)-6, int(box[1]*2)-6, int(box[2]*2)+6, int(box[3]*2)+6), fill='white')
    images.append(image)
assert images[0].size == images[1].size and ImageChops.difference(*images).getbbox() is None
print(json.dumps({'selectionOnly': True, 'fontAndPlacementRetained': True, 'unrelatedPixelsEqual': True}))
