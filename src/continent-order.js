// Presentation order uses the original 1–16 content IDs. Keep artwork, layout
// and solution together; the JSON files retain their original content order.
export const CONTINENT_ORDER_VERSION = 1;
export const continentOrder = [
  [1, 3, 8, 7, 5, 6, 11, 12, 2, 10, 14, 9, 13, 15, 16, 4],
  [1, 3, 4, 9, 5, 2, 7, 8, 10, 12, 6, 14, 13, 15, 16, 11],
  [1, 2, 4, 3, 5, 7, 8, 9, 6, 10, 12, 11, 14, 13, 16, 15],
  [1, 3, 2, 4, 6, 5, 8, 7, 9, 11, 10, 12, 13, 14, 16, 15],
  [1, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 15],
  [1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 11, 12, 14, 13, 16, 15],
].map(order => order.map(id => id - 1));

export function orderContinentLevels(layouts) {
  return continentOrder.flatMap((order, face) => order.map((contentLevel, level) => ({
    ...layouts[face * 16 + contentLevel], number: 79 + face * 16 + level, level,
  })));
}

// Move older completions, unfinished boards and records to the same content's
// new slot, once only. Do not mutate the caller's save or touch the older cubes.
export function migrateContinentOrder(raw) {
  if (raw.continentOrderVersion !== undefined && raw.continentOrderVersion !== 0) return raw;
  const moveKeys = entries => Object.fromEntries(Object.entries(entries ?? {}).map(([key, value]) => {
    const match = /^2:([0-5]):(\d+)$/.exec(key);
    const level = match ? continentOrder[Number(match[1])].indexOf(Number(match[2])) : -1;
    return [level < 0 ? key : `2:${match[1]}:${level}`, value];
  }));
  return {
    ...raw, continentOrderVersion: CONTINENT_ORDER_VERSION,
    completed: [raw.completed?.[0], raw.completed?.[1], continentOrder.flatMap((order, face) =>
      order.map(level => raw.completed?.[2]?.[face * 16 + level] === true))],
    puzzles: moveKeys(raw.puzzles), records: moveKeys(raw.records),
  };
}
