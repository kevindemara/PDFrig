"""Narrow the research binding surface without importing Leptonica private layouts.

The application uses TessBaseAPI's JSON results, not these raw object wrappers.
Unknown ownership and raw-array access fail closed rather than guessing whether
a JS pointer is borrowed, cloned or owned. This is not a general-purpose binding.
"""
import re


FIELDS = {
    'Box': ['x', 'y', 'w', 'h', 'refcount'],
    'Boxa': ['n', 'nalloc', 'refcount', 'box'],
    'PixColormap': ['array', 'depth', 'nalloc', 'n'],
    'Pta': ['n', 'nalloc', 'refcount', 'x', 'y'],
    'Pix': ['w', 'h', 'd', 'spp', 'wpl', 'refcount', 'xres', 'yres',
            'informat', 'special', 'text', 'colormap', 'data'],
    'Pixa': ['n', 'nalloc', 'refcount', 'pix', 'boxa'],
}
GETTERS = {
    'Boxa': {'n': 'boxaGetCount'},
    'PixColormap': {'n': 'pixcmapGetCount', 'depth': 'pixcmapGetDepth'},
    'Pta': {'n': 'ptaGetCount'},
    'Pix': {'w': 'pixGetWidth', 'h': 'pixGetHeight', 'd': 'pixGetDepth',
            'spp': 'pixGetSpp', 'wpl': 'pixGetWpl', 'xres': 'pixGetXRes',
            'yres': 'pixGetYRes', 'informat': 'pixGetInputFormat'},
    'Pixa': {'n': 'pixaGetCount'},
}
DENY = 'abort(); /* PDFrig candidate: unsupported raw/ownership API. */'

# The local worker supplies only canonical P6 via SetImageFile. These alternate
# pointer/file/renderer ingestion routes bypass that entry point and are unused.
INPUT_APIS = {
    'SetInputImage_1': (
        'void', 'TessBaseAPI* self, Pix* pix', 'self->SetInputImage(pix);'),
    'TesseractRect_7': (
        'char*', 'TessBaseAPI* self, const Uint8Array imagedata, int bytes_per_pixel, '
        'int bytes_per_line, int left, int top, int width, int height',
        'return self->TesseractRect(imagedata, bytes_per_pixel, bytes_per_line, left, top, width, height);'),
    'SetImage_1': (
        'void', 'TessBaseAPI* self, Pix* imagedata, int exif, const float angle',
        'self->SetImage(imagedata, exif, angle);'),
    'SetImage_5': (
        'void', 'TessBaseAPI* self, const Uint8Array imagedata, int width, int height, '
        'int bytes_per_pixel, int bytes_per_line, int exif, const float angle',
        'self->SetImage(imagedata, width, height, bytes_per_pixel, bytes_per_line, exif, angle);'),
    'ProcessPages_4': (
        'bool', 'TessBaseAPI* self, const char* filename, const char* retry_config, '
        'int timeout_millisec, TessResultRenderer* renderer',
        'return self->ProcessPages(filename, retry_config, timeout_millisec, renderer);'),
    'ProcessPage_6': (
        'bool', 'TessBaseAPI* self, Pix* pix, int page_index, const char* filename, '
        'const char* retry_config, int timeout_millisec, TessResultRenderer* renderer',
        'return self->ProcessPage(pix, page_index, filename, retry_config, timeout_millisec, renderer);'),
}

# PDF composition is owned by PDFrig, not by the OCR engine's optional renderer.
RENDERER_APIS = {
    'TessPDFRenderer_3': ('TessPDFRenderer*', 'const char* outputbase, const char* datadir, bool textonly',
                          'return new TessPDFRenderer(outputbase, datadir, textonly);'),
    'BeginDocument_1': ('bool', 'TessPDFRenderer* self, const char* title', 'return self->BeginDocument(title);'),
    'AddImage_1': ('bool', 'TessPDFRenderer* self, TessBaseAPI* api', 'return self->AddImage(api);'),
    'EndDocument_0': ('bool', 'TessPDFRenderer* self', 'return self->EndDocument();'),
    'happy_0': ('bool', 'TessPDFRenderer* self', 'return self->happy();'),
    'file_extension_0': ('const char*', 'TessPDFRenderer* self', 'return self->file_extension();'),
    'title_0': ('const char*', 'TessPDFRenderer* self', 'return self->title();'),
    'imagenum_0': ('int', 'TessPDFRenderer* self', 'return self->imagenum();'),
    '__destroy___0': ('void', 'TessPDFRenderer* self', 'delete self;'),
}


MODEL_APIS = {
    'Init_2': ('int', 'TessBaseAPI* self, const char* datapath, const char* language',
               'return self->Init(datapath, language);'),
    'ReadConfigFile_1': ('void', 'TessBaseAPI* self, const char* filename', 'self->ReadConfigFile(filename);'),
    'ReadDebugConfigFile_1': ('void', 'TessBaseAPI* self, const char* filename', 'self->ReadDebugConfigFile(filename);'),
}
GUARDED_INIT = ('int EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_Init_4'
                '(TessBaseAPI* self, const char* datapath, const char* language, OcrEngineMode oem, char* config) {\n'
                '  char *configs[64] = {config};\n'
                '  return self->Init(datapath, language, oem, configs, 1, nullptr, nullptr, false);\n}')
GUARDED_INIT3 = ('int EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_Init_3'
                 '(TessBaseAPI* self, const char* datapath, const char* language, OcrEngineMode oem) {\n'
                 '  return self->Init(datapath, language, oem);\n}')

# The worker uses JSON/UTF8 results, not native component/image ownership.
# Retain AnalyseLayout: the worker's layout-only path does call it.
OUTPUT_APIS = {
    'GetInputImage_0': ('Pix*', 'TessBaseAPI* self', 'return self->GetInputImage();'),
    'GetThresholdedImage_0': ('Pix*', 'TessBaseAPI* self', 'return self->GetThresholdedImage();'),
    'GetRegions_1': ('Boxa*', 'TessBaseAPI* self, PixaPtr* pixa', 'return self->GetRegions(pixa);'),
    'GetTextlines_2': ('Boxa*', 'TessBaseAPI* self, PixaPtr* raw_image, LongStarPtr* raw_padding',
                       'return self->GetTextlines(raw_image, raw_padding);'),
    'GetTextlines_5': ('Boxa*', 'TessBaseAPI* self, const bool raw_image, const int raw_padding, '
                       'PixaPtr* pixa, LongStarPtr* blockids, LongStarPtr* paraids',
                       'return self->GetTextlines(raw_image, raw_padding, pixa, blockids, paraids);'),
    'GetStrips_2': ('Boxa*', 'TessBaseAPI* self, PixaPtr* pixa, LongStarPtr* blockids',
                    'return self->GetStrips(pixa, blockids);'),
    'GetWords_1': ('Boxa*', 'TessBaseAPI* self, PixaPtr* pixa', 'return self->GetWords(pixa);'),
    'GetConnectedComponents_1': ('Boxa*', 'TessBaseAPI* self, PixaPtr* cc',
                                 'return self->GetConnectedComponents(cc);'),
    'GetComponentImages_4': ('Boxa*', 'TessBaseAPI* self, const PageIteratorLevel level, '
                             'const bool text_only, PixaPtr* raw_image, LongStarPtr* raw_padding',
                             'return self->GetComponentImages(level, text_only, raw_image, raw_padding);'),
    'GetComponentImages_7': ('Boxa*', 'TessBaseAPI* self, const PageIteratorLevel level, '
                             'const bool text_only, const bool raw_image, const int raw_padding, '
                             'PixaPtr* pixa, LongStarPtr* blockids, LongStarPtr* paraids',
                             'return self->GetComponentImages(level, text_only, raw_image, raw_padding, pixa, blockids, paraids);'),
    'GetIterator_0': ('ResultIterator*', 'TessBaseAPI* self', 'return self->GetIterator();'),
}
RETAINED_OUTPUT_APIS = {
    'AnalyseLayout_0': ('PageIterator*', 'TessBaseAPI* self', 'return self->AnalyseLayout();'),
    'AnalyseLayout_1': ('PageIterator*', 'TessBaseAPI* self, bool merge_similar_words',
                        'return self->AnalyseLayout(merge_similar_words);'),
    'GetUTF8Text_0': ('char*', 'TessBaseAPI* self', 'return self->GetUTF8Text();'),
    'GetJSONText_1': ('char*', 'TessBaseAPI* self, int page_number', 'return self->GetJSONText(page_number);'),
}

# Not used by the pinned worker: borrowed strings, native arrays/DAWG pointers,
# and variable getters writing through caller-supplied output pointers.
AUXILIARY_APIS = {
    'GetInputName_0': ('const char*', 'TessBaseAPI* self', 'return self->GetInputName();'),
    'GetDatapath_0': ('const char*', 'TessBaseAPI* self', 'return self->GetDatapath();'),
    'GetIntVariable_2': ('bool', 'TessBaseAPI* self, const char* name, IntPtr* value',
                         'return self->GetIntVariable(name, value);'),
    'GetBoolVariable_2': ('bool', 'TessBaseAPI* self, const char* name, BoolPtr* value',
                          'return self->GetBoolVariable(name, value);'),
    'GetDoubleVariable_2': ('bool', 'TessBaseAPI* self, const char* name, DoublePtr* value',
                            'return self->GetDoubleVariable(name, value);'),
    'GetStringVariable_1': ('const char*', 'TessBaseAPI* self, const char* name',
                            'return self->GetStringVariable(name);'),
    'GetInitLanguagesAsString_0': ('const char*', 'TessBaseAPI* self',
                                  'return self->GetInitLanguagesAsString();'),
    'AllWordConfidences_0': ('IntPtr*', 'TessBaseAPI* self', 'return self->AllWordConfidences();'),
    'GetUnichar_1': ('const char*', 'TessBaseAPI* self, int unichar_id',
                      'return self->GetUnichar(unichar_id);'),
    'GetDawg_1': ('const Dawg*', 'TessBaseAPI* self, int i', 'return self->GetDawg(i);'),
}
RETAINED_VERSION = ('const char* EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_Version_0'
                    '(TessBaseAPI* self) {\n  return self->Version();\n}')


def patch_auxiliary_apis(glue):
    prefix = 'emscripten_bind_TessBaseAPI_'
    inventory = re.findall(r'^(?:const char\*|const Dawg\*|IntPtr\*) EMSCRIPTEN_KEEPALIVE (' +
                           prefix + r'\w+)\(', glue, re.M)
    inventory += re.findall(r'^bool EMSCRIPTEN_KEEPALIVE (' + prefix +
                            r'Get\w+Variable_\d+)\(', glue, re.M)
    expected = [prefix + name for name in AUXILIARY_APIS] + [prefix + 'Version_0']
    if sorted(inventory) != sorted(expected) or glue.count(RETAINED_VERSION) != 1:
        raise RuntimeError('OCR_CANDIDATE_AUXILIARY_API_DRIFT')
    for name, (result, parameters, body) in AUXILIARY_APIS.items():
        original = f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
        if glue.count(original) != 1:
            raise RuntimeError('OCR_CANDIDATE_AUXILIARY_API_DRIFT')
        glue = glue.replace(original, original.replace(body,
            'abort(); /* PDFrig research: unused borrowed/output-pointer API. */'))
    return glue, [prefix + name for name in AUXILIARY_APIS]


def patch_text_ownership(glue):
    # The unchanged generated JS copies both results with UTF8ToString then
    # _free. Tesseract itself allocates these two particular strings with new[].
    prefix = 'emscripten_bind_TessBaseAPI_'
    for name in ['GetUTF8Text_0', 'GetJSONText_1']:
        result, parameters, body = RETAINED_OUTPUT_APIS[name]
        original = f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
        if glue.count(original) != 1:
            raise RuntimeError('OCR_CANDIDATE_TEXT_OWNERSHIP_DRIFT')
        guard = 'if (!self) return nullptr;'
        if name == 'GetJSONText_1':
            guard = 'if (!self || page_number < 0 || page_number >= 500) return nullptr;'
        call = body.removeprefix('return ').removesuffix(';')
        replacement = (f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n'
                       '  // PDFrig research: owned new[] result -> bounded malloc copy for JS _free.\n'
                       f'  {guard}\n  return pdfrigCandidateTextForJs({call}, pdfrigCandidateMaxTextBytes);\n}}')
        glue = glue.replace(original, replacement)
    return glue


def patch_output_apis(glue):
    prefix = 'emscripten_bind_TessBaseAPI_'
    # Include retained PageIterator and other opaque result types so new raw
    # component/image/iterator overloads cannot escape this reviewed inventory.
    inventory = re.findall(r'(?:Pix|Pixa|Box|Boxa|Pta|PixColormap|ResultIterator|MutableIterator|PageIterator)\* EMSCRIPTEN_KEEPALIVE (' +
                           prefix + r'\w+)\(', glue)
    expected = [prefix + name for name in OUTPUT_APIS] + [prefix + 'AnalyseLayout_0', prefix + 'AnalyseLayout_1']
    if sorted(inventory) != sorted(expected):
        raise RuntimeError('OCR_CANDIDATE_OUTPUT_API_DRIFT')
    for name, (result, parameters, body) in {**OUTPUT_APIS, **RETAINED_OUTPUT_APIS}.items():
        original = f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
        if glue.count(original) != 1:
            raise RuntimeError('OCR_CANDIDATE_OUTPUT_API_DRIFT')
        if name in OUTPUT_APIS:
            glue = glue.replace(original, original.replace(body,
                'abort(); /* PDFrig research: raw component/image output is not supported. */'))
    return glue, [prefix + name for name in OUTPUT_APIS]


def patch_model_apis(glue):
    prefix = 'emscripten_bind_TessBaseAPI_'
    inventory = re.findall(r'EMSCRIPTEN_KEEPALIVE (' + prefix + r'(?:Init_\d+|Read\w*ConfigFile_\d+))\(', glue)
    if (sorted(inventory) != sorted([prefix + name for name in MODEL_APIS] + [prefix + 'Init_3', prefix + 'Init_4'])
            or glue.count(GUARDED_INIT) != 1 or glue.count(GUARDED_INIT3) != 1):
        raise RuntimeError('OCR_CANDIDATE_MODEL_API_DRIFT')
    for name, (result, parameters, body) in MODEL_APIS.items():
        original = f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
        if glue.count(original) != 1:
            raise RuntimeError('OCR_CANDIDATE_MODEL_API_DRIFT')
        glue = glue.replace(original, original.replace(body,
            'abort(); /* PDFrig research: unused model/config entry is not supported. */'))
    return glue, [prefix + name for name in MODEL_APIS]


def patch_renderer_apis(glue):
    prefix = 'emscripten_bind_TessPDFRenderer_'
    inventory = re.findall(r'EMSCRIPTEN_KEEPALIVE (' + prefix + r'\w+)\(', glue)
    if sorted(inventory) != sorted(prefix + name for name in RENDERER_APIS):
        raise RuntimeError('OCR_CANDIDATE_RENDERER_API_DRIFT')
    for name, (result, parameters, body) in RENDERER_APIS.items():
        original = f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
        if glue.count(original) != 1:
            raise RuntimeError('OCR_CANDIDATE_RENDERER_API_DRIFT')
        glue = glue.replace(original, original.replace(body,
            'abort(); /* PDFrig research: native PDF renderer is not supported. */'))
    return glue, [prefix + name for name in RENDERER_APIS]


def patch_input_apis(glue):
    """Keep ABI names but refuse before dereferencing self or any other pointer."""
    prefix = 'emscripten_bind_TessBaseAPI_'
    guarded = 'int EMSCRIPTEN_KEEPALIVE ' + prefix + 'SetImageFile_1' + \
        '(TessBaseAPI* self, int exif, const float angle) {\n' + \
        '  return self->SetImageFile(exif, angle);\n}'
    inventory = re.findall(r'EMSCRIPTEN_KEEPALIVE (' + prefix +
                           r'(?:SetInputImage|SetImage|TesseractRect|ProcessPage)[A-Za-z]*_\d+)\(', glue)
    expected_names = [prefix + name for name in INPUT_APIS] + [prefix + 'SetImageFile_1']
    if sorted(inventory) != sorted(expected_names) or glue.count(guarded) != 1:
        raise RuntimeError('OCR_CANDIDATE_IMAGE_API_DRIFT')
    for name, (result, parameters, body) in INPUT_APIS.items():
        original = f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
        if glue.count(original) != 1:
            raise RuntimeError('OCR_CANDIDATE_IMAGE_API_DRIFT')
        replacement = original.replace(body,
            'abort(); /* PDFrig research: alternate image ingestion is not supported. */')
        glue = glue.replace(original, replacement)
    return glue, [prefix + name for name in INPUT_APIS]


def patch_bindings(glue):
    """Exact expected signatures/bodies; upstream drift is an error, not a fallback."""
    denied = []
    for kind, fields in FIELDS.items():
        for field in fields:
            name = f'emscripten_bind_{kind}_get_{field}_0'
            pattern = (r'([^\n]+EMSCRIPTEN_KEEPALIVE ' + re.escape(name) +
                       r'\(' + kind + r'\* self\) \{\n)  return self->' + field + r';\n\}')
            if len(re.findall(pattern, glue)) != 1:
                raise RuntimeError('OCR_CANDIDATE_BINDING_DRIFT')
            if kind == 'Box' and field in ['x', 'y', 'w', 'h']:
                outputs = ['&value' if part == field else 'nullptr'
                           for part in ['x', 'y', 'w', 'h']]
                body = ('  if (!self) abort();\n  l_int32 value = 0;\n' +
                        '  if (boxGetGeometry(self, ' + ', '.join(outputs) +
                        ')) abort();\n  return value;')
            elif field in GETTERS.get(kind, {}):
                body = ('  if (!self) abort();\n  return ' +
                        GETTERS[kind][field] + '(self);')
            else:
                body = '  ' + DENY
                denied.append(name)
            glue = re.sub(pattern, lambda match: match[1] + body + '\n}', glue)
        name = f'emscripten_bind_{kind}___destroy___0'
        expected = (f'void EMSCRIPTEN_KEEPALIVE {name}({kind}* self) {{\n'
                    '  delete self;\n}')
        if glue.count(expected) != 1:
            raise RuntimeError('OCR_CANDIDATE_BINDING_DRIFT')
        glue = glue.replace(expected, expected.replace('delete self;', DENY))
        denied.append(name)
    # No private-field access or C++ deletion may survive for opaque Leptonica types.
    for kind in FIELDS:
        bodies = re.findall(r'EMSCRIPTEN_KEEPALIVE emscripten_bind_' + kind +
                            r'_[^\n]+\{\n(.*?)\n\}', glue, re.S)
        if len(bodies) != len(FIELDS[kind]) + 1 or any(
                'self->' in body or 'delete self' in body for body in bodies):
            raise RuntimeError('OCR_CANDIDATE_PRIVATE_LAYOUT')
    return glue, denied


def selftest_source():
    """Synthetic public-API ownership cycle; test-only export in the research artifact."""
    return r'''
extern "C" int EMSCRIPTEN_KEEPALIVE pdfrig_candidate_leptonica_selftest() {
  for (int i = 0; i < 100; ++i) {
    Pix* pix = pixCreate(3, 2, 32);
    Box* box = boxCreate(1, 2, 3, 4);
    Boxa* boxa = boxaCreate(1);
    Pta* pta = ptaCreate(1);
    PixColormap* cmap = pixcmapCreate(8);
    Pixa* pixa = pixaCreate(1);
    if (!pix || !box || !boxa || !pta || !cmap || !pixa) abort();
    pixSetSpp(pix, 3);
    pixSetResolution(pix, 200, 200);
    ptaAddPt(pta, 1.0f, 2.0f);
    if (emscripten_bind_Pix_get_w_0(pix) != 3 ||
        emscripten_bind_Pix_get_h_0(pix) != 2 ||
        emscripten_bind_Pix_get_d_0(pix) != 32 ||
        emscripten_bind_Pix_get_spp_0(pix) != 3 ||
        emscripten_bind_Pix_get_wpl_0(pix) != 3 ||
        emscripten_bind_Pix_get_xres_0(pix) != 200 ||
        emscripten_bind_Pix_get_yres_0(pix) != 200 ||
        emscripten_bind_Pix_get_informat_0(pix) != IFF_UNKNOWN ||
        emscripten_bind_Box_get_x_0(box) != 1 ||
        emscripten_bind_Box_get_y_0(box) != 2 ||
        emscripten_bind_Box_get_w_0(box) != 3 ||
        emscripten_bind_Box_get_h_0(box) != 4 ||
        emscripten_bind_Boxa_get_n_0(boxa) != 0 ||
        emscripten_bind_Pta_get_n_0(pta) != 1 ||
        emscripten_bind_PixColormap_get_n_0(cmap) != 0 ||
        emscripten_bind_PixColormap_get_depth_0(cmap) != 8 ||
        emscripten_bind_Pixa_get_n_0(pixa) != 0) abort();
    // These local variables are owned here; generated JS destroy cannot establish that.
    pixDestroy(&pix); boxDestroy(&box); boxaDestroy(&boxa);
    ptaDestroy(&pta); pixcmapDestroy(&cmap); pixaDestroy(&pixa);
    if (pix || box || boxa || pta || cmap || pixa) abort();
  }
  return 1;
}
'''


def text_selftest_source():
    return r'''
extern "C" int EMSCRIPTEN_KEEPALIVE pdfrig_candidate_text_ownership_selftest() {
  for (int cycle = 0; cycle < 100; ++cycle) {
    char* source = new char[9];
    std::memcpy(source, "OCR 4827", 9);
    char* copy = pdfrigCandidateTextForJs(source, 8);
    if (!copy || std::strcmp(copy, "OCR 4827")) abort();
    std::free(copy);
    char* over = new char[3];
    std::memcpy(over, "xx", 3);
    if (pdfrigCandidateTextForJs(over, 1)) abort();
    if (pdfrigCandidateTextForJs(nullptr, 8)) abort();
  }
  return 1;
}
'''
