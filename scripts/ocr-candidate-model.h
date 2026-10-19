// PDFrig research: strict directory admission before TessdataManager allocates entries.
// This is not validation of LSTM/DAWG/unicharset component contents or arbitrary pointers.
#ifndef PDFRIG_CANDIDATE_MODEL_H
#define PDFRIG_CANDIDATE_MODEL_H
#include <cstdint>
#include <limits>

inline bool pdfrigModelDirectory(const char* data, int size) {
  // The research candidate supports bounded raw models with known component slots.
  // The editor separately admits only the two exact, hash-verified bundled models.
  if (!data || size < 12 || size > 16 * 1024 * 1024) return false;
  const auto* bytes = reinterpret_cast<const unsigned char*>(data);
  const auto read = [bytes](unsigned position, unsigned count, bool big) {
    std::uint64_t value = 0;
    for (unsigned i = 0; i < count; ++i)
      value |= std::uint64_t(bytes[position + i]) << (8 * (big ? count - 1 - i : i));
    return value;
  };
  auto count = read(0, 4, false);
  const bool big = count > 1000; // Same byte-order choice as the pinned loader.
  if (big) count = read(0, 4, true);
  if (count == 0 || count > 24) return false;
  const std::uint64_t header = 4 + count * 8;
  if (header >= static_cast<unsigned>(size)) return false;
  std::uint64_t previous = 0;
  bool found = false;
  for (unsigned i = 0; i < count; ++i) {
    const auto offset = read(4 + i * 8, 8, big);
    if (offset == std::numeric_limits<std::uint64_t>::max()) continue; // Only -1 is absent.
    if (offset < header || offset >= static_cast<unsigned>(size)) return false;
    if ((!found && offset != header) || (found && offset <= previous)) return false;
    found = true;
    previous = offset;
  }
  return found;
}
#endif
