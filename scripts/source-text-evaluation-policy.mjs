/** EDIT-002 research results are diagnostics, never release authorization. */
export const sourceTextEvaluationVerdict = (results) => {
  const keys = [
    'bookmarksRetained',
    'caseIndex',
    'outsidePixelsEqual',
    'sourceReplaced',
    'taggedActualTextConsistent',
    'textGeometryRetained',
  ];
  if (
    !Array.isArray(results) ||
    results.length === 0 ||
    results.length > 64 ||
    results.some(
      (row) =>
        row === null ||
        typeof row !== 'object' ||
        Object.keys(row).some((key) => !keys.includes(key)) ||
        !Number.isSafeInteger(row.caseIndex) ||
        row.caseIndex < 0 ||
        keys.filter((key) => key !== 'caseIndex').some((key) => typeof row[key] !== 'boolean'),
    ) ||
    new Set(results.map((row) => row.caseIndex)).size !== results.length
  )
    throw new Error('TEXT_EVALUATION_REPORT_INVALID');
  const blockers = [
    'DEPENDENCY_REVIEW_INCOMPLETE',
    'BROAD_FONT_LAYOUT_CORPUS_INCOMPLETE',
    'EDITOR_INTEGRATION_INCOMPLETE',
  ];
  if (results.some((row) => !row.sourceReplaced)) blockers.push('SOURCE_REPLACEMENT_FAILED');
  if (results.some((row) => !row.outsidePixelsEqual)) blockers.push('UNRELATED_RENDERING_CHANGED');
  if (results.some((row) => !row.textGeometryRetained)) blockers.push('TEXT_GEOMETRY_CHANGED');
  if (results.some((row) => !row.taggedActualTextConsistent))
    blockers.push('ACCESSIBILITY_TEXT_STALE');
  if (results.some((row) => !row.bookmarksRetained)) blockers.push('BOOKMARKS_CHANGED');
  return Object.freeze({
    blockers: Object.freeze(blockers),
    runtimeApproved: false,
    status: 'research_only',
  });
};
