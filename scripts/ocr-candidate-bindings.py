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
