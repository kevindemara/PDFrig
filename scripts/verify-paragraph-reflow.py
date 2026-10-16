"""Fixed synthetic natural reflow: independent glyph geometry and pixel QA."""
import json, subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageDraw, ImageChops
source_path, output_path = sys.argv[1:3]
short = len(sys.argv) > 3 and sys.argv[3] == 'graphics-state'
source, output = [PdfReader(path, strict=True) for path in [source_path, output_path]]
assert len(source.pages) == len(output.pages) == 1
assert source.pages[0].rotation == output.pages[0].rotation
assert list(source.pages[0].cropbox) == list(output.pages[0].cropbox)
expected = 'This is the a substantially longer introductory passage with natural wrapping line of a short paragraph. The second line keeps the same natural font.'
if short: expected = 'This is the final line of a short paragraph. The second line keeps the same natural font.'
text = output.pages[0].extract_text()
assert ''.join(text.split()) == ''.join((expected+' UNCHANGED FOOTER').split())
ns = {'x':'http://www.w3.org/1999/xhtml'}
def rows(path):
    raw = subprocess.run(['pdftotext','-bbox-layout',path,'-'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10).stdout
    return ET.fromstring(raw).findall('.//x:line',ns)
def words(line): return line.findall('x:word',ns)
def label(line): return ' '.join(word.text or '' for word in words(line))
before, after = rows(source_path), rows(output_path)
old_footer = [word.attrib for line in before if label(line)=='UNCHANGED FOOTER' for word in words(line)]
new_footer = [word.attrib for line in after if label(line)=='UNCHANGED FOOTER' for word in words(line)]
assert old_footer and old_footer == new_footer
# Use PDF text operators for geometry independent of page rotation/CropBox.
font_records=[]
for reader in [source,output]:
    current=[]
    def capture(value,cm,tm,font,size):
        if value.strip() and 'UNCHANGED FOOTER' not in value:
            current.append((str(font.get('/BaseFont')),float(size)))
    reader.pages[0].extract_text(visitor_text=capture)
    font_records.append(current)
assert font_records[1] and all(record==('/Helvetica',18.0) for record in font_records[1])
assert len(font_records[1]) >= len(font_records[0]) if short else len(font_records[1]) > len(font_records[0])
ops=output.pages[0].get_contents().operations
for operator in [b'Tz',b'Do',b're',b'f',b'f*',b'gs',b'W',b'W*']:
    assert sum(op==operator for _,op in ops) == sum(op==operator for _,op in source.pages[0].get_contents().operations)
# Poppler renders MediaBox by default. In rotated output the same fixed source
# paragraph region transforms to the right-hand side of the landscape render.
images=[]
for index,path in enumerate([source_path,output_path]):
    prefix=str(Path(output_path).with_suffix(''))+f'-render-{index}'
    subprocess.run(['pdftoppm','-singlefile','-r','144','-png',path,prefix],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
    raster=Image.open(prefix+'.png').convert('RGB')
    body=[word for line in (before if index==0 else after) if label(line)!='UNCHANGED FOOTER' for word in words(line)]
    images.append((raster,body))
all_words=images[0][1]+images[1][1]
box=(min(float(w.attrib['xMin']) for w in all_words),min(float(w.attrib['yMin']) for w in all_words),max(float(w.attrib['xMax']) for w in all_words),max(float(w.attrib['yMax']) for w in all_words))
for raster,_ in images: ImageDraw.Draw(raster).rectangle((int(box[0]*2)-5,int(box[1]*2)-5,int(box[2]*2)+5,int(box[3]*2)+5),fill='white')
assert images[0][0].size==images[1][0].size and ImageChops.difference(images[0][0],images[1][0]).getbbox() is None
print(json.dumps({'naturalWrapping':True,'fontSizeRetained':True,'footerGeometryRetained':True,'outsideParagraphPixelsEqual':True}))
