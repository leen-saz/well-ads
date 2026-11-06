// dash.json's column-wise rows (pipeline/dash_split.py) come back as the same rows the numbers read
import { describe, expect, it } from 'vitest';
import { withRows } from './useDash';

describe('withRows', () => {
  it('turns rows_cols back into [key, day, spend, impr, clicks, leads, conv] in the same order', () => {
    const d = withRows({ range: { start: '2026-10-01', end: '2026-10-02' }, rows_cols: { k: ['a', 'b'], d: ['2026-10-01', '2026-10-02'], c: [[1, 0, 1], [1, 0, 0], [1.5, 2, 0], [10, 20, 0], [1, 2, 0], [0.5, 1, 0], [0, 1, 0]] } } as never);
    expect(d.rows).toEqual([['b', '2026-10-02', 1.5, 10, 1, 0.5, 0], ['a', '2026-10-01', 2, 20, 2, 1, 1], ['b', '2026-10-01', 0, 0, 0, 0, 0]]);
    expect('rows_cols' in d).toBe(false);
  });
  it('leaves data that already has rows alone', () => {
    const plain = { rows: [['a', '2026-10-01', 1, 1, 1, 0, 0]] };
    expect(withRows(plain as never)).toBe(plain);
  });
});
