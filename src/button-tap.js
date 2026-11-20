// After a captured puzzle drag, mobile browsers can deliver a complete tap
// without a compatibility click. Activate once for either event sequence.
export function bindButtonTap(root, activate, signal) {
  let press, activated;
  root.addEventListener('pointerdown', (e) => {
    const button = e.target.closest('button');
    activated = null;
    press = e.pointerType !== 'mouse' && e.isPrimary && button && !button.disabled
      ? { button, id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  }, { signal });
  root.addEventListener('pointercancel', () => { press = null; }, { signal });
  root.addEventListener('pointerup', (e) => {
    const tap = press; press = null;
    if (!tap || tap.id !== e.pointerId || tap.button.disabled || tap.button !== e.target.closest('button') ||
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) return;
    activated = tap.button;
    activate(tap.button);
  }, { signal });
  root.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button && !button.disabled && !(e.detail && activated === button)) activate(button);
    activated = null;
  }, { signal });
}
