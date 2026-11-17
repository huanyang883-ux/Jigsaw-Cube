// Minimum squared travel for displaced pieces, with polynomial cost even at 7x7.
// The Hungarian augmenting-path algorithm assigns each blocker a distinct hole.
export function assignTiles(positions, blockers, holes, size) {
  const count = blockers.length, u = Array(count + 1).fill(0), v = [...u];
  const matched = [...u], previous = [...u];
  for (let row = 1; row <= count; row++) {
    matched[0] = row;
    let column = 0;
    const distance = Array(count + 1).fill(Infinity), used = Array(count + 1).fill(false);
    do {
      used[column] = true;
      const active = matched[column], cell = positions[blockers[active - 1]];
      let delta = Infinity, next = 0;
      for (let j = 1; j <= count; j++) {
        if (used[j]) continue;
        const hole = holes[j - 1];
        const cost = (cell % size - hole % size) ** 2 + (Math.floor(cell / size) - Math.floor(hole / size)) ** 2 - u[active] - v[j];
        if (cost < distance[j]) { distance[j] = cost; previous[j] = column; }
        if (distance[j] < delta) { delta = distance[j]; next = j; }
      }
      for (let j = 0; j <= count; j++) {
        if (used[j]) { u[matched[j]] += delta; v[j] -= delta; }
        else distance[j] -= delta;
      }
      column = next;
    } while (matched[column] !== 0);
    do {
      const next = previous[column]; matched[column] = matched[next]; column = next;
    } while (column !== 0);
  }
  const cells = Array(count);
  for (let column = 1; column <= count; column++) cells[matched[column] - 1] = holes[column - 1];
  return cells;
}
