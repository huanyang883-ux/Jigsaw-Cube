import { chooseGuide } from './guide-state.js';
import { HAND_ART } from './preload.js';

export class IdleGuide {
  constructor(host, context, target) {
    this.host = host; this.context = context; this.target = target;
    this.hand = host.querySelector('img'); this.hand.src = HAND_ART;
    this.lastActivity = performance.now(); this.pointers = new Set();
    this.abort = new AbortController(); const signal = this.abort.signal;
    const activity = () => { this.lastActivity = performance.now(); this.hide(); };
    document.addEventListener('pointerdown', (e) => { this.pointers.add(e.pointerId); activity(); }, { capture: true, signal });
    document.addEventListener('pointermove', (e) => { if (this.pointers.has(e.pointerId)) activity(); }, { capture: true, signal });
    for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, (e) => { this.pointers.delete(e.pointerId); activity(); }, { capture: true, signal });
    for (const event of ['keydown', 'click', 'wheel']) document.addEventListener(event, activity, { capture: true, passive: true, signal });
    window.addEventListener('blur', () => { this.unfocused = true; this.pointers.clear(); activity(); }, { signal });
    window.addEventListener('focus', () => { this.unfocused = false; activity(); }, { signal });
    document.addEventListener('visibilitychange', () => { this.pointers.clear(); activity(); }, { signal });
    window.addEventListener('resize', activity, { signal });
    this.timer = setInterval(() => this.update(), 80);
  }

  update() {
    const state = this.context(), now = performance.now();
    const blocked = state.blocked || document.hidden || this.unfocused || this.pointers.size > 0;
    if (state.key !== this.key || blocked || this.wasBlocked) { this.lastActivity = now; this.hide(); }
    this.key = state.key; this.wasBlocked = blocked;
    if (blocked) return;
    const kind = chooseGuide({ ...state, idleMs: now - this.lastActivity });
    if (!kind) { this.hide(); return; }
    if (this.kind === kind) return;
    const path = this.target(kind); if (!path) { this.hide(); return; }
    this.show(kind, path);
  }

  show(kind, { from, to = from }) {
    this.hide();
    this.kind = kind; this.host.dataset.guide = kind;
    this.host.style.left = `${from.x}px`; this.host.style.top = `${from.y}px`;
    this.host.hidden = false;
    const dx = to.x - from.x, dy = to.y - from.y, drag = dx !== 0 || dy !== 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transform = (x, y, scale = 1) => `translate(${x}px, ${y}px) rotate(-12deg) scale(${scale})`;
    const frames = drag ? [
      { offset: 0, opacity: 0, transform: transform(0, -14) },
      { offset: .12, opacity: 1, transform: transform(0, 0, .94) },
      { offset: .23, opacity: 1, transform: transform(0, 0, .94) },
      { offset: .7, opacity: 1, transform: transform(dx, dy, .94) },
      { offset: .82, opacity: .9, transform: transform(dx, dy - 10) },
      { offset: .93, opacity: 0, transform: transform(dx, dy - 10) },
      { offset: 1, opacity: 0, transform: transform(0, -14) },
    ] : [
      { offset: 0, opacity: 0, transform: transform(0, -18) },
      { offset: .15, opacity: 1, transform: transform(0, -8) },
      { offset: .3, opacity: 1, transform: transform(0, 0, .9) },
      { offset: .46, opacity: 1, transform: transform(0, -8) },
      { offset: .6, opacity: 1, transform: transform(0, 0, .9) },
      { offset: .76, opacity: 1, transform: transform(0, -8) },
      { offset: 1, opacity: 0, transform: transform(0, -18) },
    ];
    this.animation = this.hand.animate(reduced ? [{ opacity: .8 }, { opacity: 1 }, { opacity: .8 }] : frames, { duration: drag ? 2600 : 1900, iterations: Infinity, easing: 'ease-in-out' });
  }

  hide() {
    this.animation?.cancel(); this.animation = null; this.kind = null;
    this.host.hidden = true; delete this.host.dataset.guide;
  }
  destroy() { clearInterval(this.timer); this.abort.abort(); this.hide(); }
}
