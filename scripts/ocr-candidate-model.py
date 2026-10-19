"""Exact-source directory hardening, not whole traineddata/LSTM parser clearance."""
import hashlib
import subprocess

ORIGINAL_SHA256 = '3189b1ad5f4b1ff1e4603346a546a817664568711ea51081aa47e8daa2a7aca3'


def patch_model_loader(original):
    if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA256:
        raise RuntimeError('OCR_CANDIDATE_MODEL_SOURCE_DRIFT')
    source = original.decode('utf8')
    include = '#include "tessdatamanager.h"'
    entry = 'bool TessdataManager::LoadMemBuffer(const char *name, const char *data, int size) {\n'
    load = '  return LoadMemBuffer(data_file_name, &data[0], data.size());'
    if any(source.count(fragment) != 1 for fragment in [include, entry, load]):
        raise RuntimeError('OCR_CANDIDATE_MODEL_METHOD_DRIFT')
    source = source.replace(include, include + '\n#include "pdfrig-candidate-model.h" // PDFrig research modification\n#include <emscripten.h>')
    source = source.replace(entry, entry + '''  // PDFrig research: reject invalid directories before TFile/vector allocation.
  // Clear state on refusal. Component internals still require separate review.
  if (!name || !pdfrigModelDirectory(data, size)) {
    Clear();
    return false;
  }
''')
    source = source.replace(load, '''  // PDFrig research: never index an empty vector or narrow an unbounded size.
  if (data.empty() || data.size() > 16 * 1024 * 1024) return false;
  return LoadMemBuffer(data_file_name, data.data(), static_cast<int>(data.size()));''')
    # Test-only research export exercises the real patched loader, not a parallel JS parser.
    source += '''
extern "C" int EMSCRIPTEN_KEEPALIVE pdfrig_candidate_model_directory(const char* data, int size) {
  tesseract::TessdataManager manager;
  return manager.LoadMemBuffer("synthetic-model", data, size) ? 1 : 0;
}
'''
    return source.encode('utf8')


def test_model_directory(work):
    executable = work / 'model-directory-test'
    subprocess.run(['g++', '-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
                    '-fno-omit-frame-pointer', '-fno-pie', '-no-pie', '-I', str(work),
                    str(work / 'model-directory-test.cpp'), '-o', str(executable)],
                   check=True, timeout=60)
    result = subprocess.run([str(executable)], capture_output=True, timeout=60)
    if result.returncode != 0 or result.stderr or result.stdout != b'MODEL_DIRECTORY_PASSED\n':
        raise RuntimeError('OCR_CANDIDATE_MODEL_SANITIZER_FAILED')
    return {'sanitizers': ['address', 'undefined'], 'warningsAsErrors': True,
            'directoryByteMutations': 50176, 'deterministicMutations': 10000,
            'bothByteOrders': True, 'directoryTruncations': True,
            'maximumModelBytes': 16777216, 'maximumComponents': 24,
            'scope': 'Actual added directory preflight only; not LSTM/DAWG/component fuzz or arbitrary pointer clearance.'}
