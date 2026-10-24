"""CONV-007 synthetic, non-sensitive manual fixtures. Requires ReportLab + pypdf + Poppler.
No application runtime dependency. All table values and drawings are original CC0 test data.
"""
from pathlib import Path
import subprocess
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[1]
TEMP = ROOT / 'tmp' / 'pdfs' / 'table-examples'
OUTPUT = ROOT / 'output' / 'pdf' / 'PDFrig-table-examples.pdf'
TEMP.mkdir(parents=True, exist_ok=True)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
INK, TEAL, LINE = map(HexColor, ['#17232d', '#177e78', '#d8dee2'])

def label(c, x, y, value, size=12, bold=False, color=INK):
    c.setFillColor(color)
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    c.drawString(x, y, value)

def heading(c, title, subtitle, page):
    label(c, 44, 753, 'PDFRIG / TABLE EXTRACTION EXAMPLES', 10, True, TEAL)
    label(c, 44, 711, title, 24, True)
    label(c, 44, 684, subtitle, 10)
    c.setStrokeColor(LINE); c.line(44, 666, 568, 666)
    label(c, 44, 35, 'Synthetic CC0 test data. No client or personal information.', 8)
    label(c, 529, 35, f'{page} / 3', 9)

def table(c, headers, rows, widths, ruled=True, top=640, row_height=34):
    x0=44
    if ruled:
        c.setFillColor(TEAL); c.rect(x0, top-row_height, sum(widths), row_height, fill=1, stroke=0)
    for r, row in enumerate([headers]+rows):
        y=top-row_height*(r+1)+12
        x=x0
        for col, value in enumerate(row):
            label(c, x+9, y, value, 12 if ruled else 11, r==0, white if ruled and r==0 else INK)
            x+=widths[col]
        if ruled:
            c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(x0, top-row_height*(r+1), x0+sum(widths), top-row_height*(r+1))
    if ruled:
        x=x0
        for width in widths+[0]:
            c.line(x,top,x,top-row_height*(len(rows)+1));x+=width

text_pdf=TEMP/'selectable.pdf'
c=canvas.Canvas(str(text_pdf),pagesize=(612,792),invariant=1)
c.setTitle('PDFrig table extraction examples');c.setAuthor('PDFrig synthetic test corpus')
heading(c,'Inventory: bordered table','Select the table, not this heading or the instructions below.',1)
table(c,['Code','Item','Quantity','Amount'],[
    ['00127','Notebook','5','12.50'],['00128','Pen pack','12','30.00'],
    ['00129','Folder','0','0.00'],['00130','Credit','2','-5.25'],['00131','Desk lamp','1','100.00'],
],[85,229,80,130])
label(c,44,390,'Expected checks',14,True)
for y,s in zip([365,344,323,302],[
    '6 rows including headers; 4 columns. Codes must remain text.',
    'Quantity sum: 20. Amount sum: 137.25. Amount average: 27.45.',
    'Change any cell, confirm review resets, then export XLSX and ODS.',
    'Suggested selection: Left 7%, Top 19%, Width 86%, Height 27%.',
]):label(c,44,y,s,10)
c.showPage()
heading(c,'Borderless table: value types','Check blank cells, decimal conventions and literal formula-like text.',2)
table(c,['Code','Label','Rate','Note'],[
    ['0007','Standard','12,5%','=1+1'],['0008','Reduced','5,0%',''],
    ['0009','Amount','1.234,50','Text, not a formula'],['0010','Large ID','0,0%','1234567890123456'],
],[70,150,120,184],False)
label(c,44,422,'Expected checks',14,True)
for y,s in zip([397,376,355,334,313],[
    '5 rows including headers; 4 columns. One Note cell is blank.',
    'Auto leaves comma decimals as text. Correct / choose a column type.',
    'The Rate column mixes percentages and an amount on purpose.',
    'Remove the Amount row to test Percent (12,5%) conversion.',
    'The Note value =1+1 must stay literal text, never a formula.',
]):label(c,44,y,s,10)
c.showPage();c.save()

scan_source=TEMP/'scan-source.pdf'
c=canvas.Canvas(str(scan_source),pagesize=(612,792),invariant=1)
heading(c,'Scanned table: OCR practice','This entire page is an image. Use OCR scanned table, then review.',3)
table(c,['Product','Units','Total'],[
    ['Notebook','5','12.50'],['Pen pack','12','30.00'],['Desk lamp','1','100.00'],
],[274,100,150],False,row_height=44)
label(c,44,390,'Expected checks',14,True)
for y,s in zip([365,344,323],[
    '4 table rows including headers; 3 columns. Units sum: 18.',
    'Total sum: 142.50. Correct any OCR errors before export.',
    'Select only the table. The PDF scan itself must not change.',
]):label(c,44,y,s,10)
c.showPage();c.save()
subprocess.run(['pdftoppm','-r','200','-singlefile','-png',str(scan_source),str(TEMP/'scan')],check=True,capture_output=True)
image_pdf=TEMP/'scan-image.pdf'
c=canvas.Canvas(str(image_pdf),pagesize=(612,792),invariant=1)
c.drawImage(ImageReader(str(TEMP/'scan.png')),0,0,612,792);c.showPage();c.save()
writer=PdfWriter()
for source in [text_pdf,image_pdf]:
    for page in PdfReader(source).pages:writer.add_page(page)
writer.add_metadata({'/Title':'PDFrig table extraction examples','/Author':'PDFrig synthetic test corpus'})
with OUTPUT.open('wb') as stream:writer.write(stream)
reader=PdfReader(OUTPUT)
assert len(reader.pages)==3 and '00127' in reader.pages[0].extract_text()
assert not reader.pages[2].extract_text().strip()
print(OUTPUT)
