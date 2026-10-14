export type TextMatrix = readonly [number, number, number, number, number, number];
export const IDENTITY_TEXT_MATRIX: TextMatrix = [1, 0, 0, 1, 0, 0];
export const multiplyTextMatrices = (left: TextMatrix, right: TextMatrix): TextMatrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];
export const moveTextMatrix = (matrix: TextMatrix, x: number, y = 0): TextMatrix =>
  multiplyTextMatrices(matrix, [1, 0, 0, 1, x, y]);
