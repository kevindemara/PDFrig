"""Dependency-free patch contract checks, run before the isolated research build."""
import unittest
from ocr_candidate_bindings import FIELDS, INPUT_APIS, patch_bindings, patch_input_apis


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


if __name__ == '__main__':
    unittest.main()
