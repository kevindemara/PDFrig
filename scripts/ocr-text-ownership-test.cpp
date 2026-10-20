// Synthetic new[] -> pinned JS free contract; not whole-engine fuzzing.
#include "pdfrig-candidate-text.h"
#include <cassert>
#include <iostream>
#include <string>

static char* owned(const std::string& value) {
  char* result = new char[value.size() + 1];
  std::memcpy(result, value.c_str(), value.size() + 1);
  return result;
}

int main(int argc, char**) {
  if (argc > 1) {
    // Positive sanitizer control: the original generated JS/native contract.
    std::free(owned("synthetic original contract"));
    return 17; // Must not reach this under alloc_dealloc_mismatch=1.
  }
  assert(!pdfrigCandidateTextForJs(nullptr, 16));
  for (int cycle = 0; cycle < 1000; ++cycle) {
    for (const std::string& value : {std::string(""), std::string("OCR 4827"),
                                   std::string("BONJOUR \xc3\xa9\xc3\xa0 4827")}) {
      char* copy = pdfrigCandidateTextForJs(owned(value), value.size());
      assert(copy && std::string(copy) == value);
      std::free(copy); // Exactly what the unchanged generated JS wrapper does.
      if (!value.empty()) assert(!pdfrigCandidateTextForJs(owned(value), value.size() - 1));
    }
  }
  char* empty = pdfrigCandidateTextForJs(owned(""), 0);
  assert(empty && empty[0] == '\0');
  std::free(empty);
  const std::string maximum(pdfrigCandidateMaxTextBytes, 'x');
  char* boundary = pdfrigCandidateTextForJs(owned(maximum), pdfrigCandidateMaxTextBytes);
  assert(boundary && std::string(boundary) == maximum);
  std::free(boundary);
  assert(!pdfrigCandidateTextForJs(owned(maximum + "x"), pdfrigCandidateMaxTextBytes));
  assert(!pdfrigCandidateTextForJs(owned("short"), pdfrigCandidateMaxTextBytes + 1));
  for (std::size_t length = 0; length < 2048; ++length) {
    std::string value(length, 'x');
    for (std::size_t index = 0; index < length; ++index)
      value[index] = static_cast<char>(1 + (index * 131 + length * 17) % 255);
    char* copy = pdfrigCandidateTextForJs(owned(value), length);
    assert(copy && std::memcmp(copy, value.c_str(), length + 1) == 0);
    std::free(copy);
    if (length) assert(!pdfrigCandidateTextForJs(owned(value), length - 1));
  }
  std::cout << "TEXT_OWNERSHIP_PASSED\n";
}
