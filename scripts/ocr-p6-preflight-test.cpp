// Synthetic-only tests of the exact header included by the candidate engine.
#include "pdfrig-candidate-p6.h"
#include <cstdlib>
#include <string>
#include <vector>

static void checkAt(bool value, int line) {
  if (!value) { std::fprintf(stderr, "P6_ASSERTION_LINE_%d\n", line); std::abort(); }
}
#define check(value) checkAt((value), __LINE__)
static bool accepts(const std::string& bytes) {
  // This image's glibc rejects a zero-sized fmemopen; use an actual empty file.
  FILE* input = bytes.empty() ? std::tmpfile() :
    fmemopen(const_cast<char*>(bytes.data()), bytes.size(), "rb");
  check(input != nullptr);
  const bool result = pdfrigCanonicalP6(input);
  if (result) check(std::ftell(input) == 0);
  check(std::fclose(input) == 0);
  return result;
}
static std::string raster(unsigned int width, unsigned int height) {
  return "P6\n" + std::string(512, ' ') + std::to_string(width) + " " +
    std::to_string(height) + "\n255\n" + std::string(width * height * 3, '\xff');
}
// Independent small-input oracle: enumerate the valid dimensions for these
// mutations and compare an independently encoded header and exact body length.
static bool smallOracle(const std::string& bytes) {
  static const auto cases = [] {
    std::vector<std::pair<std::string, std::size_t>> output;
    for (unsigned int width = 1; width <= 32; ++width)
      for (unsigned int height = 1; height <= 32; ++height) {
        const std::string header = "P6\n" + std::string(512, ' ') +
          std::to_string(width) + " " + std::to_string(height) + "\n255\n";
        output.emplace_back(header, header.size() + width * height * 3);
      }
    return output;
  }();
  for (const auto& entry : cases)
    if (bytes.size() == entry.second && bytes.compare(0, entry.first.size(), entry.first) == 0)
      return true;
  return false;
}
int main() {
  check(!pdfrigCanonicalP6(nullptr));
  const std::string valid = raster(3, 2);
  check(accepts(valid));
  check(accepts(raster(1, 1)));
  check(accepts(raster(32, 32)));
  for (std::size_t size = 0; size < valid.size(); ++size)
    check(!accepts(valid.substr(0, size)));
  check(!accepts(valid + '\0'));
  check(!accepts(valid + valid));
  for (std::size_t offset = 0; offset < 515; ++offset)
    for (unsigned int byte = 0; byte < 256; ++byte) {
      if (byte == static_cast<unsigned char>(valid[offset])) continue;
      std::string changed = valid;
      changed[offset] = static_cast<char>(byte);
      check(!accepts(changed));
    }
  for (const std::string dimensions : {"0 1", "1 0", "01 2", "+3 2", "-3 2",
       "3\t2", "3  2", "3 2\r", "99999999 99999999", "100000000 1",
       "20000001 1", "1 20000001", "3 2\n# comment", "3 2\n65535"})
    check(!accepts("P6\n" + std::string(512, ' ') + dimensions + "\n255\n" +
                  std::string(18, '\xff')));
  // Bodies are opaque RGB, including whitespace, NUL, headers and EXIF patterns.
  for (std::size_t i = valid.size() - 18; i < valid.size(); ++i)
    for (unsigned int byte = 0; byte < 256; ++byte) {
      std::string changed = valid;
      changed[i] = static_cast<char>(byte);
      check(accepts(changed));
    }
  std::uint32_t random = 0x50444652;
  for (int iteration = 0; iteration < 10000; ++iteration) {
    std::string changed = valid;
    random = random * 1664525u + 1013904223u;
    const std::size_t offset = random % changed.size();
    random = random * 1664525u + 1013904223u;
    changed[offset] = static_cast<char>(random >> 24);
    check(accepts(changed) == smallOracle(changed));
  }
  // Sparse files test full limits without allocating attacker-sized buffers.
  for (const unsigned int pixels : {20000000u, 20000001u}) {
    FILE* input = std::tmpfile();
    check(input != nullptr);
    const std::string header = "P6\n" + std::string(512, ' ') +
      std::to_string(pixels) + " 1\n255\n";
    check(std::fwrite(header.data(), 1, header.size(), input) == header.size());
    check(std::fseek(input, header.size() + pixels * 3 - 1, SEEK_SET) == 0);
    check(std::fputc(0, input) == 0);
    check(pdfrigCanonicalP6(input) == (pixels == 20000000u));
    check(std::fclose(input) == 0);
  }
  std::puts("P6_PREFLIGHT_PASSED");
}
