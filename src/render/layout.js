// @ts-check
import { truncate, visibleWidth } from '../terminal.js';

export const DIVIDER = ' │ ';
export const PIPE = ' | ';

/** @typedef {{line: string, activity: boolean}} Row */

/** Plan expanded rows using only column widths and already-rendered sections.
 *  @param {string[]} order
 *  @param {{mergeGroups: string[][], rightAlign: string[], width: number, isActivity: (key: string) => boolean}} layout
 *  @param {(key: string, align?: boolean) => string[]} section
 *  @returns {Row[]}
 */
export function expandedRows(order, { mergeGroups, rightAlign, width, isActivity }, section) {
  const rows = [];
  const groups = new Map();
  for (const group of mergeGroups) for (const element of group) {
    if (!groups.has(element)) groups.set(element, group);
  }
  for (let index = 0; index < order.length;) {
    const group = groups.get(order[index]);
    let end = index + 1;
    while (end < order.length && group && group === groups.get(order[end])) end += 1;
    const entries = order.slice(index, end).map((key) => ({ key, lines: section(key).filter(Boolean) }))
      .filter(({ lines }) => lines.length);
    index = end;
    const joined = entries.map(({ lines }) => lines.join(DIVIDER)).join(DIVIDER);
    if (entries.length > 1 && entries.every(({ lines }) => lines.length === 1) && visibleWidth(joined) <= width) {
      const split = entries.findIndex(({ key }) => rightAlign.includes(key));
      let line = joined;
      if (split > 0 && Number.isFinite(width)) {
        const left = entries.slice(0, split).map(({ lines }) => lines[0]).join(DIVIDER);
        const right = entries.slice(split).map(({ lines }) => lines[0]).join(DIVIDER);
        line = left + ' '.repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
      }
      rows.push({ line, activity: entries.some(({ key }) => isActivity(key)) });
    } else {
      for (const { key, lines } of entries) {
        const parts = entries.length > 1 ? section(key, true) : lines;
        rows.push(...parts.map((line) => ({ line, activity: isActivity(key) })));
      }
    }
  }
  return rows;
}

/** @param {Row[]} rows
 *  @param {{width: number, color: boolean, separator?: (line: string) => string}} options
 */
export function formatRows(rows, { width, color, separator }) {
  const visible = rows.filter(({ line }) => line);
  const firstActivity = visible.findIndex(({ activity }) => activity);
  if (separator && firstActivity > 0) {
    const count = Math.min(width, Math.max(20, ...visible.slice(0, firstActivity).map(({ line }) => visibleWidth(line))));
    visible.splice(firstActivity, 0, { line: separator('─'.repeat(count)), activity: false });
  }
  return visible.map(({ line }) => (color ? '\x1b[0m' : '') + (Number.isFinite(width) ? truncate(line, width) : line)).join('\n');
}
