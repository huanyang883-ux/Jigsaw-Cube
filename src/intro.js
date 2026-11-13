export const INTRO_TIMING = Object.freeze({ hold: 500, shake: 1000, reveal: 2000 });
export const INTRO_DURATION = INTRO_TIMING.hold + INTRO_TIMING.shake + INTRO_TIMING.reveal;
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => v * v * (3 - 2 * v);

export function createIntroPlan(count, random = Math.random) {
  const order = Array.from({ length: count }, (_, id) => id);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Irregular positive gaps, normalized so the last card lands at exactly 3.5 s.
  const gaps = Array.from({ length: Math.max(0, count - 1) }, () => .35 + random());
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  const cards = Array(count);
  let elapsed = 0;
  order.forEach((id, rank) => {
    if (rank) elapsed += gaps[rank - 1];
    cards[id] = {
      start: total ? elapsed / total * 1450 : 0,
      duration: rank === count - 1 ? 550 : 440 + random() * 110,
      phase: random() * Math.PI * 2,
      frequency: 9 + random() * 5,
      direction: random() < .5 ? -1 : 1,
    };
  });
  return cards;
}

// Offsets are measured in tile widths/heights; settled pieces return exactly home.
export function introPose(elapsed, card) {
  const revealAt = INTRO_TIMING.hold + INTRO_TIMING.shake;
  const local = clamp((elapsed - revealAt - card.start) / card.duration);
  if (local === 1 || elapsed >= INTRO_DURATION) return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  const strength = clamp((elapsed - INTRO_TIMING.hold) / INTRO_TIMING.shake) ** 1.6;
  const shake = strength * (1 - smooth(local)) * (1 - .6 * clamp((elapsed - revealAt) / INTRO_TIMING.reveal));
  const wave = Math.max(0, elapsed - INTRO_TIMING.hold) / 1000 * card.frequency * Math.PI * 2;
  const flip = smooth(local), arc = Math.sin(local * Math.PI);
  return {
    x: Math.sin(wave + card.phase) * .018 * shake,
    y: Math.sin(wave * 1.17 + card.phase * 2) * .014 * shake,
    z: (1 + Math.sin(wave * .73 + card.phase)) * .016 * shake + arc * .12,
    rx: Math.sin(wave * .81 + card.phase) * .065 * shake,
    ry: card.direction * Math.PI * (1 - flip),
    rz: Math.sin(wave * .93 + card.phase * 3) * .032 * shake,
  };
}
