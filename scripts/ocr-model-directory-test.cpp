// Synthetic directory mutations only. No proprietary documents or arbitrary model payload parsing.
#include "pdfrig-candidate-model.h"
#include <cassert>
#include <cstdio>
#include <vector>

static void put(std::vector<char>& bytes, unsigned at, std::uint64_t value,
                unsigned length, bool big = false) {
  for (unsigned i = 0; i < length; ++i)
    bytes[at + i] = static_cast<char>(value >> (8 * (big ? length - 1 - i : i)));
}
static std::vector<char> fixture(bool big = false) {
  std::vector<char> bytes(204, 'x');
  put(bytes, 0, 24, 4, big);
  for (unsigned i = 0; i < 24; ++i) put(bytes, 4 + i * 8, UINT64_MAX, 8, big);
  put(bytes, 4 + 17 * 8, 196, 8, big);
  put(bytes, 4 + 23 * 8, 200, 8, big);
  return bytes;
}
static bool admit(const std::vector<char>& bytes, int size = -1) {
  return pdfrigModelDirectory(bytes.data(), size == -1 ? static_cast<int>(bytes.size()) : size);
}
int main() {
  assert(!pdfrigModelDirectory(nullptr, 100));
  const auto valid = fixture();
  assert(!pdfrigModelDirectory(valid.data(), -1));
  assert(!pdfrigModelDirectory(valid.data(), 16 * 1024 * 1024 + 1));
  for (bool big : {false, true}) {
    auto bytes = fixture(big);
    assert(admit(bytes));
    // Header/directory truncations; payload truncation can be structurally valid.
    for (int length = 0; length <= 196; ++length) assert(!admit(bytes, length));
    for (auto count : std::initializer_list<std::uint64_t>{0, 25, 1000, UINT64_C(0xffffffff)}) {
      bytes = fixture(big); put(bytes, 0, count, 4, big); assert(!admit(bytes));
    }
    for (auto offset : std::initializer_list<std::uint64_t>{0, 1, 195, 197, 204, UINT64_C(0x8000000000000000), UINT64_MAX - 1}) {
      bytes = fixture(big); put(bytes, 4 + 17 * 8, offset, 8, big); assert(!admit(bytes));
    }
    for (auto offset : std::initializer_list<std::uint64_t>{195, 196, 204, UINT64_MAX - 1}) {
      bytes = fixture(big); put(bytes, 4 + 23 * 8, offset, 8, big); assert(!admit(bytes));
    }
    bytes = fixture(big);
    put(bytes, 4 + 17 * 8, UINT64_MAX, 8, big);
    put(bytes, 4 + 23 * 8, UINT64_MAX, 8, big);
    assert(!admit(bytes));
  }
  // Every possible one-byte directory mutation. Some remain valid by design.
  for (unsigned position = 0; position < 196; ++position)
    for (unsigned value = 0; value < 256; ++value) {
      auto bytes = valid;
      bytes[position] = static_cast<char>(value);
      (void)admit(bytes);
    }
  std::uint32_t state = 0x4f435231;
  for (unsigned i = 0; i < 10000; ++i) {
    auto bytes = valid;
    for (unsigned j = 0; j < 8; ++j) {
      state = state * 1664525 + 1013904223;
      bytes[state % 196] = static_cast<char>(state >> 24);
    }
    (void)admit(bytes);
  }
  std::puts("MODEL_DIRECTORY_PASSED");
}
