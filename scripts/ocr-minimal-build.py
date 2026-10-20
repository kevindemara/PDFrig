"""Research-only build. No document inputs, network, Windows executables or installed assets."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
from ocr_candidate_bindings import patch_bindings, patch_input_apis, patch_renderer_apis, patch_model_apis, patch_output_apis, selftest_source
from ocr_candidate_recode import patch_recodebeam, test_backport
from ocr_candidate_p6 import patch_baseapi, test_preflight
from ocr_candidate_model import patch_model_loader, test_model_directory

work = Path('/work')
pins = json.loads((work / 'source-pins.json').read_text())

def run(*args):
    subprocess.run(args, check=True)

run('python3', str(work / 'bindings_test.py'))
p6_tests = test_preflight(work)
model_tests = test_model_directory(work)

def unpack(source, destination):
    archive = work / (source['id'] + '.tar.gz')
    if hashlib.sha256(archive.read_bytes()).hexdigest() != source['sha256']:
        raise RuntimeError('OCR_CANDIDATE_SOURCE_MISMATCH')
    total = 0
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if len(members) > 50000:
            raise RuntimeError('OCR_CANDIDATE_ARCHIVE_LIMIT')
        for member in members:
            parts = PurePosixPath(member.name).parts
            if member.name.startswith('/') or '..' in parts or not parts:
                raise RuntimeError('OCR_CANDIDATE_UNSAFE_ARCHIVE')
            if len(parts) == 1:
                continue
            if not member.isdir() and not member.isfile():
                raise RuntimeError('OCR_CANDIDATE_UNSAFE_ARCHIVE')
            target = destination.joinpath(*parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                total += member.size
                if total > 512 * 1024 * 1024 or member.size > 64 * 1024 * 1024:
                    raise RuntimeError('OCR_CANDIDATE_ARCHIVE_LIMIT')
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as input_file, target.open('xb') as output_file:
                    shutil.copyfileobj(input_file, output_file)

core = work / 'source/core'
locations = {'core': core, 'tesseract': core / 'third_party/tesseract',
             'leptonica': core / 'third_party/leptonica'}
for source in pins['sources']:
    unpack(source, locations[source['id']])

# Copy the pinned toolchain cache into the only writable mount, never alter the image.
shutil.copytree('/emsdk/upstream/emscripten/cache', work / 'em-cache')
tess = locations['tesseract']
model_path = tess / 'src/ccutil/tessdatamanager.cpp'
model_path.write_bytes(patch_model_loader(model_path.read_bytes()))
shutil.copyfile(work / 'pdfrig-candidate-model.h', tess / 'src/ccutil/pdfrig-candidate-model.h')
baseapi_path = tess / 'src/api/baseapi.cpp'
baseapi_path.write_bytes(patch_baseapi(baseapi_path.read_bytes()))
shutil.copyfile(work / 'pdfrig-candidate-p6.h', tess / 'src/api/pdfrig-candidate-p6.h')
recode_path = tess / 'src/lstm/recodebeam.h'
original_recode = recode_path.read_bytes()
patched_recode = patch_recodebeam(original_recode, (work / 'upstream-recodebeam.h').read_bytes())
recode_tests = test_backport(work, original_recode, patched_recode)
recode_path.write_bytes(patched_recode)
cmake_path = tess / 'CMakeLists.txt'
cmake = cmake_path.read_text()
start = cmake.index('target_link_libraries         (libtesseract PUBLIC\n  ${CMAKE_PREFIX_PATH}/lib/libgif.a')
end = cmake.index('target_link_libraries           (${WASM_NAME} libtesseract)', start)
# Deliberate candidate modification: remove upstream's forced codec/OpenLibm archives.
cmake = cmake[:start] + cmake[end:]
if cmake.count('-s ERROR_ON_UNDEFINED_SYMBOLS=0') != 1:
    raise RuntimeError('OCR_CANDIDATE_PATCH_DRIFT')
cmake = cmake.replace('-s ERROR_ON_UNDEFINED_SYMBOLS=0', '-s ERROR_ON_UNDEFINED_SYMBOLS=1')
cmake_path.write_text(cmake)
wrapper_path = core / 'javascript/src/wrapper.cpp'
wrapper = wrapper_path.read_text()
if wrapper.count('#include <allheaders.h>') != 1:
    raise RuntimeError('OCR_CANDIDATE_PATCH_DRIFT')
# Do not expose private Leptonica layouts merely to compile old generated glue.
if 'pix_internal.h' in wrapper:
    raise RuntimeError('OCR_CANDIDATE_PRIVATE_LAYOUT')
glue_path = core / 'javascript/src/glue.cpp'
glue = glue_path.read_text()
glue, denied_bindings = patch_bindings(glue)
glue, denied_image_bindings = patch_input_apis(glue)
glue, denied_renderer_bindings = patch_renderer_apis(glue)
glue, denied_model_bindings = patch_model_apis(glue)
glue, denied_output_bindings = patch_output_apis(glue)
for unavailable in ['self->ClearAdaptiveClassifier();',
                    'return self->GetOsdText(page_number);',
                    'return self->DetectOS(osr);', 'self->print_scores();']:
    if glue.count(unavailable) != 1:
        raise RuntimeError('OCR_CANDIDATE_PATCH_DRIFT')
    # LSTM-only candidate deliberately refuses legacy/OSD APIs. Keep strict
    # linking rather than letting Emscripten synthesize missing-symbol stubs.
    glue = glue.replace(unavailable, 'abort(); /* PDFrig candidate: unsupported legacy/OSD API. */')
# glue.cpp closes its own extern-C block; these names live in namespace tesseract.
glue += selftest_source()
glue_path.write_text(glue)

dep = work / 'dep'
lept_build = locations['leptonica'] / 'build'
codec_packages = ['GIF', 'JPEG', 'PNG', 'TIFF', 'ZLIB', 'PkgConfig']
run('emcmake', 'cmake', '-S', str(locations['leptonica']), '-B', str(lept_build),
    '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_PROG=OFF',
    '-DSW_BUILD=OFF', '-DLIBWEBP_SUPPORT=OFF', '-DOPENJPEG_SUPPORT=OFF',
    '-DCMAKE_INSTALL_PREFIX=' + str(dep),
    *['-DCMAKE_DISABLE_FIND_PACKAGE_' + name + '=TRUE' for name in codec_packages])
run('cmake', '--build', str(lept_build), '--target', 'install', '--parallel', '4')

build = tess / 'build'
run('emcmake', 'cmake', '-S', str(tess), '-B', str(build),
    '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_PREFIX_PATH=' + str(dep),
    '-DLeptonica_DIR=' + str(lept_build), '-DWASM_BUILD=ON',
    '-DOPENMP_BUILD=OFF', '-DBUILD_TRAINING_TOOLS=OFF', '-DGRAPHICS_DISABLED=ON',
    '-DDISABLED_LEGACY_ENGINE=ON', '-DDISABLE_TIFF=ON', '-DDISABLE_ARCHIVE=ON',
    '-DDISABLE_CURL=ON', '-DHAVE_SSE4_1=OFF', '-DHAVE_AVX=OFF', '-DHAVE_AVX2=OFF',
    '-DCMAKE_CXX_FLAGS=-O2 -sMAXIMUM_MEMORY=1073741824')
run('cmake', '--build', str(build), '--target', 'tesseract-core-lstm.wasm', '--parallel', '4')
artifact = build / 'bin/tesseract-core-lstm.wasm.js'
config = (lept_build / 'src/config_auto.h').read_text()
disabled = ['HAVE_LIBGIF', 'HAVE_LIBJP2K', 'HAVE_LIBJPEG', 'HAVE_LIBPNG',
            'HAVE_LIBTIFF', 'HAVE_LIBWEBP', 'HAVE_LIBWEBP_ANIM', 'HAVE_LIBZ']
if not all('/* #undef ' + macro + ' */' in config for macro in disabled):
    raise RuntimeError('OCR_CANDIDATE_UNEXPECTED_CODEC')
link = (build / 'CMakeFiles/tesseract-core-lstm.wasm.dir/linklibs.rsp').read_text()
archives = re.findall(r'[^\s\"]+\.a', link)
if sorted(Path(archive).name for archive in archives) != ['libleptonica.a', 'libtesseract.a']:
    raise RuntimeError('OCR_CANDIDATE_UNEXPECTED_ARCHIVE')
result = {'schemaVersion': 1, 'publicReleaseApproved': False,
          'runtimeReplacementApproved': False, 'variant': 'baseline-lstm',
          'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(),
          'bytes': artifact.stat().st_size,
          'sourcePins': pins['sources'],
          'modifiedTesseractCmakeSha256': hashlib.sha256(cmake_path.read_bytes()).hexdigest(),
          'modifiedWrapperSha256': hashlib.sha256(wrapper_path.read_bytes()).hexdigest(),
          'modifiedGlueSha256': hashlib.sha256(glue_path.read_bytes()).hexdigest(),
          'modifiedRecodebeamSha256': hashlib.sha256(patched_recode).hexdigest(),
          'modifiedBaseapiSha256': hashlib.sha256(baseapi_path.read_bytes()).hexdigest(),
          'modifiedModelLoaderSha256': hashlib.sha256(model_path.read_bytes()).hexdigest(),
          'nativeModelPreflightSha256': hashlib.sha256((work / 'pdfrig-candidate-model.h').read_bytes()).hexdigest(),
          'nativeModelPreflightTests': model_tests,
          'nativeP6PreflightSha256': hashlib.sha256((work / 'pdfrig-candidate-p6.h').read_bytes()).hexdigest(),
          'nativeP6PreflightTests': p6_tests,
          'recodeNodeOwnershipTests': recode_tests,
          'leptonicaPrivateLayouts': False,
          'deniedRawOwnershipBindings': denied_bindings,
          'deniedAlternateImageBindings': denied_image_bindings,
          'deniedRendererBindings': denied_renderer_bindings,
          'deniedModelBindings': denied_model_bindings,
          'deniedRawOutputBindings': denied_output_bindings,
          'publicApiSelftestCycles': 100,
          'disabledCodecMacros': disabled,
          'linkedApplicationArchives': sorted(Path(archive).name for archive in archives),
          'removedForcedArchives': ['gif', 'jpeg', 'png', 'tiff', 'webp', 'zlib', 'openlibm']}
shutil.copyfile(artifact, work / 'tesseract-core-lstm.wasm.cjs')
(work / 'candidate-build.json').write_text(json.dumps(result, indent=2) + '\n')
print('OCR research baseline built. Not adopted or approved for release.', flush=True)
