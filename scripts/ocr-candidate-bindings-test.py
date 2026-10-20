"""Dependency-free patch contract checks, run before the isolated research build."""
import unittest
from ocr_candidate_bindings import (FIELDS, INPUT_APIS, RENDERER_APIS, MODEL_APIS,
                                    GUARDED_INIT, GUARDED_INIT3, patch_bindings, patch_input_apis,
                                    patch_renderer_apis, patch_model_apis, OUTPUT_APIS,
                                    RETAINED_OUTPUT_APIS, patch_output_apis,
                                    AUXILIARY_APIS, RETAINED_VERSION, patch_auxiliary_apis,
                                    patch_text_ownership)


def fixture():
    parts = []
    for kind, fields in FIELDS.items():
        for field in fields:
            parts.append(f'int EMSCRIPTEN_KEEPALIVE emscripten_bind_{kind}_get_{field}_0'
                         f'({kind}* self) {{\n  return self->{field};\n}}')
        parts.append(f'void EMSCRIPTEN_KEEPALIVE emscripten_bind_{kind}___destroy___0'
                     f'({kind}* self) {{\n  delete self;\n}}')
    return '\n\n'.join(parts)


class BindingContract(unittest.TestCase):
    def test_public_getters_and_fail_closed_ownership(self):
        patched, denied = patch_bindings(fixture())
        self.assertNotIn('self->', patched)
        self.assertNotIn('delete self', patched)
        self.assertIn('boxGetGeometry(self, &value, nullptr, nullptr, nullptr)', patched)
        self.assertIn('pixGetWidth(self)', patched)
        self.assertIn('ptaGetCount(self)', patched)
        self.assertEqual(len(denied), 25)
        self.assertEqual(len(set(denied)), len(denied))
        self.assertEqual(sum('___destroy___' in name for name in denied), 6)

    def test_changed_body_rejected(self):
        for original in ['return self->w;', 'delete self;', '(Pix* self)']:
            with self.subTest(original=original), self.assertRaisesRegex(
                    RuntimeError, 'OCR_CANDIDATE_BINDING_DRIFT'):
                patch_bindings(fixture().replace(original, 'changed', 1))

    def test_missing_duplicate_and_new_binding_rejected(self):
        original = fixture()
        for changed in [original[original.index('\n\n') + 2:],
                        original + '\n' + original,
                        original + '\nint EMSCRIPTEN_KEEPALIVE emscripten_bind_Pix_get_new_0'
                        '(Pix* self) {\n  return self->new_field;\n}']:
            with self.subTest(), self.assertRaises(RuntimeError):
                patch_bindings(changed)

    def test_not_idempotent_or_silent_fallback(self):
        with self.assertRaises(RuntimeError):
            patch_bindings(patch_bindings(fixture())[0])


def image_fixture():
    prefix = 'emscripten_bind_TessBaseAPI_'
    parts = [f'{result} EMSCRIPTEN_KEEPALIVE {prefix}{name}({parameters}) {{\n  {body}\n}}'
             for name, (result, parameters, body) in INPUT_APIS.items()]
    parts.append('int EMSCRIPTEN_KEEPALIVE ' + prefix + 'SetImageFile_1'
                 '(TessBaseAPI* self, int exif, const float angle) {\n'
                 '  return self->SetImageFile(exif, angle);\n}')
    return '\n\n'.join(parts)


class ImageApiContract(unittest.TestCase):
    def test_six_alternates_trap_but_worker_entry_survives(self):
        patched, denied = patch_input_apis(image_fixture())
        self.assertEqual(len(denied), 6)
        self.assertEqual(len(set(denied)), 6)
        self.assertEqual(patched.count('abort();'), 6)
        self.assertEqual(patched.count('self->'), 1)
        self.assertIn('return self->SetImageFile(exif, angle);', patched)
        for name in INPUT_APIS:
            self.assertIn('emscripten_bind_TessBaseAPI_' + name, patched)

    def test_body_signature_missing_duplicate_and_new_overload_fail(self):
        original = image_fixture()
        for altered in [original.replace('self->SetInputImage(pix);', 'changed;'),
                        original.replace('Pix* pix', 'Other* pix', 1),
                        original.replace('SetImage_1(', 'SetImage_2(', 1),
                        original[original.index('\n\n') + 2:], original + original,
                        original + '\nvoid EMSCRIPTEN_KEEPALIVE '
                        'emscripten_bind_TessBaseAPI_SetImageNew_9() {\n}\n',
                        original.replace('self->SetImageFile(exif, angle);', 'changed;')]:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_IMAGE_API_DRIFT'):
                patch_input_apis(altered)

    def test_no_second_application(self):
        with self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_IMAGE_API_DRIFT'):
            patch_input_apis(patch_input_apis(image_fixture())[0])


def renderer_fixture():
    return '\n\n'.join(f'{result} EMSCRIPTEN_KEEPALIVE emscripten_bind_TessPDFRenderer_{name}'
                       f'({parameters}) {{\n  {body}\n}}'
                       for name, (result, parameters, body) in RENDERER_APIS.items())


class RendererContract(unittest.TestCase):
    def test_all_nine_symbols_refuse_before_allocation_or_pointer_access(self):
        patched, denied = patch_renderer_apis(renderer_fixture())
        self.assertEqual(len(denied), 9)
        self.assertEqual(patched.count('abort();'), 9)
        self.assertNotIn('self->', patched)
        self.assertNotIn('new TessPDFRenderer', patched)
        self.assertNotIn('delete self', patched)

    def test_drift_new_missing_duplicate_and_reapplication_refused(self):
        source = renderer_fixture()
        for altered in [source.replace('self->happy();', 'changed;'),
                        source.replace('const char* title', 'char* title'),
                        source[source.index('\n\n') + 2:], source + source,
                        source + '\nvoid EMSCRIPTEN_KEEPALIVE emscripten_bind_TessPDFRenderer_New_0() {\n}\n',
                        patch_renderer_apis(source)[0]]:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_RENDERER_API_DRIFT'):
                patch_renderer_apis(altered)


def model_fixture():
    return '\n\n'.join(f'{result} EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_{name}'
                       f'({parameters}) {{\n  {body}\n}}'
                       for name, (result, parameters, body) in MODEL_APIS.items()) + '\n' + GUARDED_INIT + '\n' + GUARDED_INIT3


class ModelApiContract(unittest.TestCase):
    def test_unused_entries_refuse_but_worker_init_survives(self):
        patched, denied = patch_model_apis(model_fixture())
        self.assertEqual(len(denied), 3)
        self.assertEqual(patched.count('abort();'), 3)
        self.assertEqual(patched.count('self->'), 2)
        self.assertIn(GUARDED_INIT, patched)
        self.assertIn(GUARDED_INIT3, patched)

    def test_drift_missing_duplicate_overload_and_reapplication_refused(self):
        source = model_fixture()
        for altered in [source.replace('self->ReadConfigFile(filename);', 'changed;'),
                        source.replace('const char* datapath', 'char* datapath', 1),
                        source[source.index('\n\n') + 2:], source + source,
                        source.replace('configs, 1, nullptr', 'configs, 2, nullptr'),
                        source.replace('self->Init(datapath, language, oem);', 'changed;'),
                        source + '\nvoid EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_Init_5() {\n}\n',
                        patch_model_apis(source)[0]]:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_MODEL_API_DRIFT'):
                patch_model_apis(altered)


def output_fixture():
    return '\n\n'.join(f'{result} EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_{name}'
                       f'({parameters}) {{\n  {body}\n}}'
                       for name, (result, parameters, body) in
                       {**OUTPUT_APIS, **RETAINED_OUTPUT_APIS}.items())


class OutputApiContract(unittest.TestCase):
    def test_eleven_raw_outputs_refused_and_worker_outputs_retained(self):
        patched, denied = patch_output_apis(output_fixture())
        self.assertEqual(len(denied), 11)
        self.assertEqual(len(set(denied)), 11)
        self.assertEqual(patched.count('abort();'), 11)
        self.assertEqual(patched.count('self->'), 4)
        for _, _, body in RETAINED_OUTPUT_APIS.values():
            self.assertIn(body, patched)

    def test_each_body_signature_and_missing_symbol_refused(self):
        source = output_fixture()
        for name, (result, parameters, body) in {**OUTPUT_APIS, **RETAINED_OUTPUT_APIS}.items():
            for altered in [source.replace(body, 'changed;', 1),
                            source.replace(f'{name}({parameters})', f'{name}(Other* self)', 1),
                            source.replace(f'{result} EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_{name}',
                                           'removed', 1)]:
                with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_OUTPUT_API_DRIFT'):
                    patch_output_apis(altered)

    def test_new_overloads_duplicates_and_reapplication_refused(self):
        source = output_fixture()
        for altered in [source + source, patch_output_apis(source)[0],
                        source + '\nPix* EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_GetNew_0() {\n}\n',
                        source + '\nPixa* EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_GetNew_0() {\n}\n',
                        source + '\nMutableIterator* EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_GetNew_0() {\n}\n',
                        source + '\nPageIterator* EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_AnalyseLayout_2() {\n}\n']:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_OUTPUT_API_DRIFT'):
                patch_output_apis(altered)


class AuxiliaryApiContract(unittest.TestCase):
    def fixture(self):
        return '\n\n'.join(f'{result} EMSCRIPTEN_KEEPALIVE emscripten_bind_TessBaseAPI_{name}'
                           f'({parameters}) {{\n  {body}\n}}'
                           for name, (result, parameters, body) in AUXILIARY_APIS.items()) + '\n' + RETAINED_VERSION

    def test_ten_unused_apis_refuse_and_version_survives(self):
        patched, denied = patch_auxiliary_apis(self.fixture())
        self.assertEqual(len(denied), 10)
        self.assertEqual(len(set(denied)), 10)
        self.assertEqual(patched.count('abort();'), 10)
        self.assertEqual(patched.count('self->'), 1)
        self.assertIn(RETAINED_VERSION, patched)

    def test_each_signature_body_missing_duplicate_and_reapplication_refused(self):
        source = self.fixture()
        altered = [source + source, patch_auxiliary_apis(source)[0],
                   source.replace('self->Version();', 'changed;')]
        for name, (_, parameters, body) in AUXILIARY_APIS.items():
            altered.extend([source.replace(body, 'changed;', 1),
                            source.replace(f'{name}({parameters})', f'{name}(Other* self)', 1),
                            source.replace(f'emscripten_bind_TessBaseAPI_{name}', 'removed', 1)])
        for changed in altered:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_AUXILIARY_API_DRIFT'):
                patch_auxiliary_apis(changed)

    def test_new_pointer_outputs_and_overloads_refuse(self):
        for result in ['const char*', 'const Dawg*', 'IntPtr*', 'bool']:
            suffix = 'GetNewVariable_3' if result == 'bool' else 'GetNew_3'
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_AUXILIARY_API_DRIFT'):
                patch_auxiliary_apis(self.fixture() + f'\n{result} EMSCRIPTEN_KEEPALIVE '
                                     f'emscripten_bind_TessBaseAPI_{suffix}() {{\n}}')


class TextOwnershipContract(unittest.TestCase):
    def test_two_owned_results_use_bounded_bridge_and_page_number_guard(self):
        patched = patch_text_ownership(output_fixture())
        self.assertEqual(patched.count('pdfrigCandidateTextForJs('), 2)
        self.assertIn('page_number < 0 || page_number >= 500', patched)
        self.assertIn('pdfrigCandidateTextForJs(self->GetUTF8Text(),', patched)
        self.assertIn('pdfrigCandidateTextForJs(self->GetJSONText(page_number),', patched)
        self.assertNotIn('_free(', patched)

    def test_drift_missing_duplicate_and_reapplication_refuse(self):
        source = output_fixture()
        for altered in [source + source, source.replace('return self->GetUTF8Text();', 'changed;'),
                        source.replace('GetJSONText_1(TessBaseAPI* self, int page_number)',
                                       'GetJSONText_1(TessBaseAPI* self, long page_number)'),
                        source.replace('emscripten_bind_TessBaseAPI_GetUTF8Text_0', 'removed'),
                        patch_text_ownership(source)]:
            with self.subTest(), self.assertRaisesRegex(RuntimeError, 'OCR_CANDIDATE_TEXT_OWNERSHIP_DRIFT'):
                patch_text_ownership(altered)


if __name__ == '__main__':
    unittest.main()
