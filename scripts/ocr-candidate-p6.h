// PDFrig research-only native preflight for local-ocr-pixels.ts output.
// Not a general PNM parser. No allocations or attacker-controlled read sizes.
#ifndef PDFRIG_CANDIDATE_P6_H
#define PDFRIG_CANDIDATE_P6_H
#include <cstdio>
#include <cstdint>
#include <initializer_list>

static inline bool pdfrigCanonicalP6(FILE* input) {
  if (!input || std::fseek(input, 0, SEEK_END) != 0) return false;
  const long length = std::ftell(input);
  if (length < 526 || length > 60000540 || std::fseek(input, 0, SEEK_SET) != 0)
    return false;
  unsigned char prefix[515];
  if (std::fread(prefix, 1, sizeof(prefix), input) != sizeof(prefix) ||
      prefix[0] != 'P' || prefix[1] != '6' || prefix[2] != '\n') return false;
  for (unsigned int i = 3; i < sizeof(prefix); ++i)
    if (prefix[i] != ' ') return false;
  std::uint32_t dimensions[2] = {0, 0};
  for (int axis = 0; axis < 2; ++axis) {
    int next = std::fgetc(input);
    if (next < '1' || next > '9') return false;
    unsigned int digits = 0;
    do {
      if (++digits > 8) return false;
      dimensions[axis] = dimensions[axis] * 10 + static_cast<unsigned int>(next - '0');
      next = std::fgetc(input);
    } while (next >= '0' && next <= '9');
    if (next != (axis == 0 ? ' ' : '\n')) return false;
  }
  for (const char expected : {'2', '5', '5', '\n'})
    if (std::fgetc(input) != expected) return false;
  const long header = std::ftell(input);
  const std::uint64_t pixels = std::uint64_t(dimensions[0]) * dimensions[1];
  if (header < 0 || pixels > 20000000 ||
      std::uint64_t(length) != std::uint64_t(header) + pixels * 3 || std::ferror(input))
    return false;
  // The decoder consumes this same open stream, not a reopened pathname.
  return std::fseek(input, 0, SEEK_SET) == 0;
}
#endif
