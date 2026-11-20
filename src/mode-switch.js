import './mode-switch.css';
import { createBackTexture } from './card-back.js';
import { icon } from './icons.js';

const modeNames = { A: '方块拼图', B: '经典拼图' };

function makeEmblems() {
  // Use the same painted card back as the two-by-two cube stickers.
  const texture = createBackTexture(1, 0);
  const candy = texture.image;
  texture.dispose();
  candy.setAttribute('aria-hidden', 'true');
  const piece = document.createElement('span');
  piece.innerHTML = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g transform="rotate(-10 32 32)" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 18h11c2.3 0 2.5-1 1.4-3.3-2.2-5.2.2-9.2 5.4-9.2s7.7 4.1 5.4 9.2c-1 2.3-.8 3.3 1.4 3.3H48q3 0 3 3v10c0 2-1 2.5-3.4 1.6-5-2-8.3.6-8.3 5s3.5 7.1 8.3 5.1c2.4-1 3.4-.5 3.4 1.5V53q0 3-3 3H35c-2.3 0-2.5-1.1-1.5-3.3 2.2-5-.3-8.6-5.1-8.6s-7.5 3.7-5.3 8.6c1 2.2.9 3.3-1.3 3.3H14q-3 0-3-3V21q0-3 3-3Z"
        fill="#ffc36f" stroke="#774d35" stroke-width="2.8"/>
      <path d="M16 35V24h9m5-13q2-3 5-1" fill="none" stroke="#fff1cc" stroke-width="3.4"/>
    </g></svg>`;
  return { A: candy, B: piece.firstElementChild };
}

export function mountModeSwitch(toolbar, onSelect) {
  const viewport = toolbar.closest('.viewport');
  const root = document.createElement('div');
  root.className = 'mode-switch';
  root.hidden = true;
  root.innerHTML = `
    <button id="mode-switch" type="button" class="mode-switch-button" aria-expanded="false" aria-controls="mode-switch-alternate">
      <span class="mode-emblem"></span>
      <svg class="mode-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="mode-lock" aria-hidden="true">${icon('lock')}</span>
    </button>
    <button id="mode-switch-alternate" type="button" class="mode-switch-button mode-alternate" aria-hidden="true" inert><span class="mode-emblem"></span></button>`;
  toolbar.append(root);
  const [trigger, alternate] = root.querySelectorAll('button');
  const lock = trigger.querySelector('.mode-lock');
  const listeners = new AbortController();
  const events = { signal: listeners.signal };
  let mode, emblems, unlocked = false, open = false;

  function setOpen(next) {
    open = next;
    root.classList.toggle('is-open', next);
    trigger.setAttribute('aria-expanded', String(next));
    alternate.setAttribute('aria-hidden', String(!next));
    alternate.inert = !next;
  }
  function close(restoreFocus = false) {
    if (!open) return;
    setOpen(false);
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function requestOpen(next) {
    if (trigger.disabled) return;
    if (unlocked) {
      setOpen(next);
      return;
    }
    trigger.classList.remove('lock-feedback');
    void trigger.offsetWidth;
    trigger.classList.add('lock-feedback');
  }
  trigger.addEventListener('animationend', event => {
    if (event.target === lock) trigger.classList.remove('lock-feedback');
  }, events);
  trigger.addEventListener('click', () => requestOpen(!open), events);
  alternate.addEventListener('click', () => {
    if (!open || trigger.disabled) return;
    close(true);
    onSelect(alternate.dataset.mode);
  }, events);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      requestOpen(true);
      if (open) alternate.focus();
    } else if (open && (event.key === 'Escape' || event.key === 'ArrowUp')) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (open && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.stopPropagation();
    }
  }, events);
  function dismissOutside(event) {
    if (open && !root.contains(event.target)) close();
  }
  document.addEventListener('pointerdown', dismissOutside, { ...events, capture: true });
  document.addEventListener('focusin', dismissOutside, events);

  return {
    update({ mode: next, visible, unlocked: canSwitch, disabled = false }) {
      viewport.dataset.playMode = next;
      if (!visible || disabled || next !== mode || unlocked !== canSwitch) {
        close();
        trigger.classList.remove('lock-feedback');
      }
      root.hidden = !visible;
      trigger.disabled = disabled;
      if (!visible || (next === mode && canSwitch === unlocked)) return;
      unlocked = canSwitch;
      root.classList.toggle('is-locked', !unlocked);
      trigger.setAttribute('aria-label', `当前玩法 ${next} · ${modeNames[next]}，${unlocked ? '选择玩法' : '玩法切换尚未解锁'}`);
      if (next === mode) return;
      mode = next;
      emblems ??= makeEmblems();
      const other = mode === 'A' ? 'B' : 'A';
      for (const [button, value] of [[trigger, mode], [alternate, other]]) {
        button.dataset.mode = value;
        button.querySelector('.mode-emblem').replaceChildren(emblems[value]);
      }
      alternate.setAttribute('aria-label', `切换到玩法 ${other} · ${modeNames[other]}`);
    },
    get open() { return open; },
    close,
    destroy() {
      listeners.abort();
      root.remove();
      delete viewport.dataset.playMode;
    },
  };
}
