"""EDIT-001/FORM-002: independent verification of the synthetic tagged fixture."""
import sys
from pypdf import PdfReader
from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject, StreamObject


def snapshot(reader):
    pages = {page.indirect_reference.idnum for page in reader.pages}
    records = {}

    def visit(value):
        if isinstance(value, IndirectObject):
            identity = (value.idnum, value.generation)
            if value.idnum not in pages and identity not in records:
                records[identity] = None
                obj = value.get_object()
                if isinstance(obj, DictionaryObject) and obj.get('/Subtype') == '/Widget':
                    records[identity] = [(key, visit(obj.raw_get(key))) for key in
                                         ['/Type', '/Subtype', '/P', '/Rect', '/StructParent'] if key in obj]
                else:
                    records[identity] = visit(obj)
            return ('ref', identity)
        if isinstance(value, StreamObject):
            return (visit(DictionaryObject(value)), value.get_data())
        if isinstance(value, DictionaryObject):
            return [(key, visit(value.raw_get(key))) for key in sorted(value) if key != '/Length']
        if isinstance(value, ArrayObject):
            return [visit(item) for item in value]
        return str(value)

    root = reader.trailer['/Root']
    roots = [visit(root.raw_get(key)) for key in ['/StructTreeRoot', '/MarkInfo', '/Lang']]
    return roots, records


source, output = [PdfReader(path, strict=True) for path in sys.argv[1:3]]
assert len(source.pages) == len(output.pages) == 2
assert snapshot(source) == snapshot(output)
assert output.trailer['/Root']['/Lang'] == 'en-CA'
assert output.trailer['/Root']['/MarkInfo']['/Marked']
tree = output.trailer['/Root']['/StructTreeRoot']
assert tree['/RoleMap']['/CustomParagraph'] == '/P'
assert tree['/ClassMap']['/ParagraphStyle']['/TextAlign'] == '/Start'
assert tree['/IDTree']['/Names'][0] == 'paragraph-0'
assert len(tree['/K']) == 3
nums = tree['/ParentTree']['/Nums']
for index in range(2):
    paragraph = tree['/K'][index].get_object()
    assert paragraph['/S'] == '/CustomParagraph'
    assert paragraph['/K'][0]['/MCID'] == 0
    assert paragraph['/Pg'].indirect_reference == output.pages[index].indirect_reference
    assert nums[index * 2] == index
    assert nums[index * 2 + 1][0] == tree['/K'][index]
    before = source.pages[index].get_contents().get_data()
    after = output.pages[index].get_contents().get_data()
    assert before in after
    assert output.pages[index]['/StructParents'] == index
    assert output.pages[index].rotation == source.pages[index].rotation
    assert output.pages[index].mediabox == source.pages[index].mediabox
objr = tree['/K'][2].get_object()['/K']
assert objr['/Type'] == '/OBJR'
widget = objr['/Obj']
assert widget['/StructParent'] == 2
assert widget.indirect_reference in output.pages[0]['/Annots']
assert nums[5] == tree['/K'][2]
assert output.get_fields()['tagged-field']['/V'] == 'Filled value'
assert len(output.outline) == 1
assert output.outline[0]['/Title'] == 'Tagged chapter'
assert output.get_destination_page_number(output.outline[0]) == 0
assert 'Tagged document overlay' in output.pages[0].extract_text()
print('QA_TAGGED_EXPORT_PRESERVED')
