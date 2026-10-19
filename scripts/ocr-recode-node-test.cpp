// Synthetic research ownership checks. No documents or language models.
#include <cassert>
#include <cstdint>
#include <cstring>

enum PermuterType { TOP_CHOICE_PERM, TEST_PERM };
constexpr int INVALID_UNICHAR_ID = -1;
struct UNICHARSET;
#define ASSERT_HOST(value) assert(value)
struct DawgPositionVector {
  static int live;
  static int destroyed;
  int* marker;
  explicit DawgPositionVector(int value) : marker(new int(value)) { ++live; }
  ~DawgPositionVector() { delete marker; --live; ++destroyed; }
};
int DawgPositionVector::live = 0;
int DawgPositionVector::destroyed = 0;
#include "recode-node-under-test.inc"

static void verify(const RecodeNode& node, const RecodeNode* previous, int marker) {
  assert(node.code == 7 && node.unichar_id == 42 && node.permuter == TEST_PERM);
  assert(node.start_of_dawg && !node.start_of_word && node.end_of_word && node.duplicate);
  assert(node.certainty == 0.5f && node.score == 3.5f && node.prev == previous);
  assert(node.code_hash == 0x123456789abcdef0ULL);
  assert(node.dawgs && *node.dawgs->marker == marker);
}
int main() {
  // Negative control: the unpatched assignment must lose its owned pointer
  // on self-assignment and return exactly 17, not an unrelated sanitizer crash.
  {
    RecodeNode node;
    node.dawgs = new DawgPositionVector(1);
    const auto pointer = node.dawgs;
    node = node;
    if (node.dawgs != pointer) return 17;
    assert(*node.dawgs->marker == 1);
  }
  for (int cycle = 0; cycle < 1000; ++cycle) {
    const int before = DawgPositionVector::destroyed;
    {
      RecodeNode previous;
      RecodeNode source(7, 42, TEST_PERM, true, false, true, true, 0.5f, 3.5f,
                        &previous, new DawgPositionVector(cycle), 0x123456789abcdef0ULL);
      auto owned = source.dawgs;
      RecodeNode copied(source);
      assert(!source.dawgs && copied.dawgs == owned);
      verify(copied, &previous, cycle);
      copied = copied;
      assert(copied.dawgs == owned);
      verify(copied, &previous, cycle);
      RecodeNode target;
      target.dawgs = new DawgPositionVector(-1);
      target = copied;
      assert(!copied.dawgs && target.dawgs == owned);
      assert(DawgPositionVector::destroyed == before + 1);
      verify(target, &previous, cycle);
      RecodeNode last;
      last = target;
      assert(!target.dawgs && last.dawgs == owned);
      verify(last, &previous, cycle);
      RecodeNode empty;
      last = empty;
      assert(!last.dawgs && !empty.dawgs);
      empty = empty;
      assert(!empty.dawgs);
    }
    assert(DawgPositionVector::live == 0);
    assert(DawgPositionVector::destroyed == before + 2);
  }
  return 0;
}
