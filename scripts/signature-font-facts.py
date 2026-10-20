"""Optional asset regeneration only. Parses one hash-pinned, unmodified OFL font.

FontTools is an isolated, MIT-licensed development tool, never an app dependency.
The derived outline cache is PDFrig Script Preview (OFL-1.1), not a renamed or
modified TrueType font. PDF exports continue embedding the original font bytes.
"""
import hashlib
import io
import json
from pathlib import Path
import sys

wheel = Path(sys.argv[1])
if (wheel.stat().st_size != 1213142 or hashlib.sha256(wheel.read_bytes()).hexdigest() !=
        '4304f03ed7f4ba000a8dcc941ad854bfa52e2f3b6112b8f099b6f431cf98e701'):
    raise RuntimeError('SIGNATURE_FACTS_TOOL_MISMATCH')
sys.path.insert(0, str(wheel.resolve()))
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

data = sys.stdin.buffer.read(133637)
if len(data) != 133636 or hashlib.sha256(data).hexdigest() != '21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c':
    raise RuntimeError('SIGNATURE_FACTS_FONT_MISMATCH')
font = TTFont(io.BytesIO(data), lazy=False)
glyph_set = font.getGlyphSet()


def number(value):
    value = round(value, 2)
    return '0' if value == 0 else ('%.2f' % value).rstrip('0').rstrip('.')


class OutlinePen(BasePen):
    def __init__(self):
        super().__init__(glyph_set)
        self.commands = []

    def add(self, command, *points):
        self.commands.append(command + ' '.join(number(v) for point in points for v in point))

    def _moveTo(self, point): self.add('M', point)
    def _lineTo(self, point): self.add('L', point)
    def _qCurveToOne(self, control, point): self.add('Q', control, point)
    def _curveToOne(self, a, b, point): self.add('C', a, b, point)
    def _closePath(self): self.commands.append('Z')
    def _endPath(self): raise RuntimeError('SIGNATURE_FACTS_OPEN_OUTLINE')


cmap = font.getBestCmap()
characters = sorted((code, font.getGlyphID(name)) for code, name in cmap.items())
gsub = font['GSUB'].table
ccmp_lookups = sorted({index for feature in gsub.FeatureList.FeatureRecord
                       if feature.FeatureTag == 'ccmp' for index in feature.Feature.LookupListIndex})
substitutions = []
for index in ccmp_lookups:
    lookup = gsub.LookupList.Lookup[index]
    if lookup.LookupType != 4:
        raise RuntimeError('SIGNATURE_FACTS_SHAPING_TYPE_' + str(lookup.LookupType))
    for subtable in lookup.SubTable:
        for first, ligatures in subtable.ligatures.items():
            for ligature in ligatures:
                substitutions.append([[font.getGlyphID(first)] + [font.getGlyphID(name) for name in ligature.Component],
                                      font.getGlyphID(ligature.LigGlyph)])
substitutions.sort()
glyphs = []
for gid in sorted(set(gid for _, gid in characters) | {gid for _, gid in substitutions}):
    name = font.getGlyphName(gid)
    pen = OutlinePen()
    glyph_set[name].draw(pen)
    glyphs.append([gid, font['hmtx'].metrics[name][0], ''.join(pen.commands)])
head, hhea, os2, post = (font[tag] for tag in ['head', 'hhea', 'OS/2', 'post'])
facts = {
    'schemaVersion': 1,
    'dataName': 'PDFrig Script Preview',
    'sourceFontSha256': hashlib.sha256(data).hexdigest(),
    'postscriptName': font['name'].getDebugName(6),
    'unitsPerEm': head.unitsPerEm,
    'ascent': hhea.ascent,
    'descent': hhea.descent,
    'capHeight': os2.sCapHeight,
    'xHeight': os2.sxHeight,
    'italicAngle': post.italicAngle,
    'familyClass': os2.sFamilyClass,
    'italic': bool(head.macStyle & 2),
    'isFixedPitch': bool(post.isFixedPitch),
    'bbox': {'minX': head.xMin, 'minY': head.yMin, 'maxX': head.xMax, 'maxY': head.yMax},
    'characters': characters,
    'substitutions': substitutions,
    'glyphs': glyphs,
}
print(json.dumps(facts, separators=(',', ':'), ensure_ascii=True))
