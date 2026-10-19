"""Exact upstream ownership backport, research-only. No warning-silencing casts."""
import hashlib
import re
import subprocess

ORIGINAL_SHA256 = '08e441fe5d069e863540abc8293b7c4a12321473e0c2ae8d4c4c8ddb64c47027'
UPSTREAM_SHA256 = '52cb49e0bf288160d5a6b892f5060014a66681e3180010a7cd84a901210b0347'
UPSTREAM_COMMIT = '565e3bd72a0ecc4814ccffbda3f17afcb40d75ef'
METHOD = r'  RecodeNode &operator=\(const RecodeNode &src\) \{\n.*?    return \*this;\n  \}'


def patch_recodebeam(original, upstream):
    for contents, expected in [(original, ORIGINAL_SHA256), (upstream, UPSTREAM_SHA256)]:
        if hashlib.sha256(contents).hexdigest() != expected:
            raise RuntimeError('OCR_CANDIDATE_RECODE_SOURCE_DRIFT')
    before, reference = original.decode('utf8'), upstream.decode('utf8')
    methods = re.findall(METHOD, before, re.S)
    replacements = re.findall(METHOD, reference, re.S)
    if len(methods) != 1 or len(replacements) != 1:
        raise RuntimeError('OCR_CANDIDATE_RECODE_METHOD_DRIFT')
    # Preserve the upstream copyright and all other old-fork code verbatim.
    notice = '// PDFrig research: assignment backport from tesseract-ocr ' + UPSTREAM_COMMIT + '.\n'
    patched = before.replace(methods[0], notice + replacements[0])
    if 'memcpy(this, &src' in patched or 'if (this != &src)' not in patched:
        raise RuntimeError('OCR_CANDIDATE_RECODE_PATCH_INVALID')
    return patched.encode('utf8')


def extracted_node(header):
    # Compile the actual struct, not a reimplementation. Stubs in the harness
    # replace only external enum/vector dependencies; they do not replace its logic.
    match = re.search(r'struct RecodeNode \{\n.*?\n\};', header.decode('utf8'), re.S)
    if not match:
        raise RuntimeError('OCR_CANDIDATE_RECODE_TEST_DRIFT')
    return header[:header.index(b'#ifndef')] + match[0].encode('utf8') + b'\n'


def test_backport(work, original, patched):
    results = []
    for label, header, expected in [('original-control', original, 17), ('patched', patched, 0)]:
        directory = work / ('recode-test-' + label)
        directory.mkdir()
        (directory / 'recode-node-under-test.inc').write_bytes(extracted_node(header))
        executable = directory / 'ownership-test'
        flags = ['-std=c++17', '-O1', '-g', '-Wall', '-Wextra',
                 '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
                 '-fno-omit-frame-pointer', '-fno-pie', '-no-pie']
        if label == 'patched':
            flags.append('-Werror')
        subprocess.run(['g++', *flags, '-I', str(directory),
                        str(work / 'recode-test.cpp'), '-o', str(executable)],
                       check=True, timeout=60)
        result = subprocess.run([str(executable)], capture_output=True, timeout=30)
        # The old source must fail the self-assignment invariant, not merely
        # crash or fail compilation. Patched code must pass without diagnostics.
        if result.returncode != expected or result.stderr:
            raise RuntimeError('OCR_CANDIDATE_RECODE_SANITIZER_FAILED')
        results.append({'source': label, 'exitCode': result.returncode})
    return {'cycles': 1000, 'sanitizers': ['address', 'undefined'],
            'patchedWarningsAsErrors': True, 'results': results,
            'scope': 'Extracted actual RecodeNode with instrumented external ownership stubs; not whole-engine fuzz/sanitizer clearance.'}
