// PDFrig research-only bridge for the two owned Tesseract text results.
// Original code: MIT. Never pass borrowed strings or arbitrary pointers here.
#ifndef PDFRIG_CANDIDATE_TEXT_H
#define PDFRIG_CANDIDATE_TEXT_H
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <memory>

constexpr std::size_t pdfrigCandidateMaxTextBytes = 8 * 1024 * 1024;

// GetUTF8Text/GetJSONText allocate with new[]. The pinned JS wrapper calls
// _free after UTF8ToString, so return a separate malloc-owned copy and release
// the original with delete[]. Reject over-budget results; never truncate them.
// This bounds the bridge copy, NOT the preceding native result construction.
inline char* pdfrigCandidateTextForJs(char* owned, std::size_t maximumBytes) {
  std::unique_ptr<char[]> input(owned);
  if (!input || maximumBytes > pdfrigCandidateMaxTextBytes) return nullptr;
  std::size_t length = 0;
  while (length <= maximumBytes && input[length] != '\0') ++length;
  if (length > maximumBytes) return nullptr;
  char* output = static_cast<char*>(std::malloc(length + 1));
  if (!output) return nullptr;
  std::memcpy(output, input.get(), length + 1);
  return output;
}
#endif
