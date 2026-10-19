"""Hash-bound worker entry-point hardening; research artifact only."""
import hashlib
import re
import subprocess

ORIGINAL_SHA256 = '13e4b10e89549b70fe9c89c24a4590241d9c880fdcd116ef33de963da91856f1'


def patch_baseapi(original):
    if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA256:
        raise RuntimeError('OCR_CANDIDATE_P6_SOURCE_DRIFT')
    source = original.decode('utf8')
    old = '    Pix *pix = pixRead(filename1);'
    if source.count(old) != 1:
        raise RuntimeError('OCR_CANDIDATE_P6_METHOD_DRIFT')
    source = source.replace('#include <allheaders.h> //',
                            '#include "pdfrig-candidate-p6.h" // PDFrig research modification\n'
                            '#include <allheaders.h> //')
    source = source.replace(old, '''    // PDFrig research: only canonical bounded RGB from the local editor.
    // Refuse orientation/rotation outside that contract before any image decode.
    if (exif != 1 || angle != 0.0f) return 1;
    FILE *input = fopen(filename1, "rb");
    if (!input) return 1;
    if (!pdfrigCanonicalP6(input)) {
      fclose(input);
      return 1;
    }
    Pix *pix = pixReadStreamPnm(input);
    fclose(input);''')
    method = re.search(r'int TessBaseAPI::SetImageFile\(.*?\n\}', source, re.S)
    if not method or 'pixRead(' in method[0] or method[0].count('pixReadStreamPnm(input)') != 1:
        raise RuntimeError('OCR_CANDIDATE_P6_PATCH_INVALID')
    return source.encode('utf8')


def test_preflight(work):
    executable = work / 'p6-preflight-test'
    subprocess.run(['g++', '-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
                    '-fno-omit-frame-pointer', '-fno-pie', '-no-pie', '-I', str(work),
                    str(work / 'p6-test.cpp'), '-o', str(executable)],
                   check=True, timeout=60)
    result = subprocess.run([str(executable)], capture_output=True, timeout=60)
    if result.returncode != 0 or result.stderr or result.stdout != b'P6_PREFLIGHT_PASSED\n':
        # Synthetic-only diagnostics, never document bytes or extracted text.
        print(result.stderr.decode('utf8', errors='replace'), flush=True)
        raise RuntimeError('OCR_CANDIDATE_P6_SANITIZER_FAILED')
    return {'sanitizers': ['address', 'undefined'], 'warningsAsErrors': True,
            'prefixMutations': 131325, 'deterministicMutations': 10000,
            'allTruncations': True, 'exactPixelLimit': 20000000,
            'scope': 'Actual native preflight header, not whole Leptonica/model fuzz clearance.'}
