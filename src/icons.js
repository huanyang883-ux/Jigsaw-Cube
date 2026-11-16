const paths = {
  candy: '<g transform="rotate(-20 12 12)"><path d="m6 12-4-4q-2 4 0 8Zm12 0 4-4q2 4 0 8Z"/><rect x="6" y="7" width="12" height="10" rx="4"/><path d="M10 9q-2 3 0 6"/></g>',
  cake: '<path d="M4 13h16v8H4Zm1 0V9h14v4M3 21h18M8 9V6m8 3V6m-4 3V4M4 16c2 3 4-3 6 0s4-3 6 0 4 0 4 0"/><path d="M12 1v1M8 3v1m8-1v1"/>',
  paw: '<ellipse cx="5" cy="8" rx="2.1" ry="3" transform="rotate(-24 5 8)"/><ellipse cx="10" cy="5" rx="2.1" ry="3"/><ellipse cx="15.5" cy="5.5" rx="2.1" ry="3"/><ellipse cx="20" cy="9" rx="2" ry="2.8" transform="rotate(24 20 9)"/><path d="M7 14c2-5 6-5 9 0 5 4 2 8-2 6-2-1-3-1-5 0-5 2-7-3-2-6Z"/>',
  sound: '<path d="m11 5-6 5H2v4h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-6 5H2v4h3l6 5Z"/><path d="m16 9 6 6m0-6-6 6"/>',
  back: '<path d="m10 4-7 7 7 7M3 11h11c6 0 7 6 4 10"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  gear: '<path d="m10 2-.6 2.5-2 .9L5 4.7 2.7 8.3l1.8 1.8v3.8l-1.8 1.8L5 19.3l2.4-.7 2 .9L10 22h4l.6-2.5 2-.9 2.4.7 2.3-3.6-1.8-1.8v-3.8l1.8-1.8L19 4.7l-2.4.7-2-.9L14 2Z"/><circle cx="12" cy="12" r="3.5"/>',
  play: '<path d="M8 4q-2-1-2 2v12q0 3 2 2l13-8Z" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v5c0 3 10 7 10 10v5M17 2v5c0 3-10 7-10 10v5M9 18h6M9 6h6"/>',
  check: '<path d="m5 12 5 5L20 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  bulb: '<path d="M8 15c-7-6-1-14 5-12 7 1 7 8 3 12l-1 3H9ZM9 21h6m-5-7h4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5m-9 5v10M8 4l9 5v10M7 19V9l9-5M3 12l9 5 9-5"/>',
  flower: '<path d="M12 8C3-2 0 9 8 12c-10 9 1 12 4 4 9 10 12-1 4-4 10-9-1-12-4-4Z"/><circle cx="12" cy="12" r="2.5"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0ZM7 5H3v3c0 3 3 4 5 4m9-7h4v3c0 3-3 4-5 4m-4 2v5m-5 2h10M9 19h6"/>',
};
export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.cube}</svg>`;
export const gridIcon = (n) => `<svg class="icon grid-icon" viewBox="0 0 24 24" aria-hidden="true">${Array.from({ length: n * n }, (_, i) => `<rect x="${3 + i % n * 18 / n}" y="${3 + Math.floor(i / n) * 18 / n}" width="${18 / n - 1.3}" height="${18 / n - 1.3}" rx="1" fill="currentColor"/>`).join('')}</svg>`;
