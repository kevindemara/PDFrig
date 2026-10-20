"""Research text ownership contract; unchanged JavaScript still frees its copy."""
import os
import subprocess
import hashlib


def verify_text_source_contract(core, tess):
    sources = [
        (core / 'javascript/glue.js', '5cf9ed8d01ec206d4bf770df091c7fd0be7fe889ba0daa6a2f63ad519a657e08'),
        (tess / 'src/api/baseapi.cpp', '13e4b10e89549b70fe9c89c24a4590241d9c880fdcd116ef33de963da91856f1'),
        (tess / 'src/api/jsonrenderer.cpp', 'b9ccb07e2cdcfc77ff0bbc27660989231eea80f1aabaf776049f7396d8bf53d6'),
    ]
    for file, expected in sources:
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise RuntimeError('OCR_CANDIDATE_TEXT_SOURCE_DRIFT')
    return {file.name: expected for file, expected in sources}


def test_text_ownership(work):
    executable = work / 'text-ownership-test'
    subprocess.run(['g++', '-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
                    '-fno-omit-frame-pointer', '-fno-pie', '-no-pie', '-I', str(work),
                    str(work / 'text-ownership-test.cpp'), '-o', str(executable)],
                   check=True, timeout=60)
    environment = dict(os.environ, ASAN_OPTIONS='alloc_dealloc_mismatch=1:detect_leaks=1:exitcode=42')
    control = subprocess.run([str(executable), 'original-control'], capture_output=True,
                             env=environment, timeout=30)
    if control.returncode != 42 or b'alloc-dealloc-mismatch' not in control.stderr:
        raise RuntimeError('OCR_CANDIDATE_TEXT_CONTROL_FAILED')
    patched = subprocess.run([str(executable)], capture_output=True, env=environment, timeout=60)
    if patched.returncode or patched.stderr or patched.stdout != b'TEXT_OWNERSHIP_PASSED\n':
        raise RuntimeError('OCR_CANDIDATE_TEXT_SANITIZER_FAILED')
    return {'sanitizers': ['address', 'undefined'], 'warningsAsErrors': True,
            'cycles': 1000, 'deterministicLengths': 2048, 'maximumTextBytes': 8388608,
            'originalControlExit': 42, 'patchedExit': 0,
            'scope': 'Actual bridge with synthetic owned new[] strings and unchanged free contract; not whole-native result allocation, arbitrary-pointer or parser clearance.'}
