import './style.css';
import './background.css';
import { mountUI } from './ui.js';
import { icon, gridIcon } from './icons.js';
import { CubeScene } from './cube-scene.js';
import { PuzzleRenderer } from './renderer.js';
import { GameAudio } from './audio.js';
import { THEME_ART } from './theme-art.js';
import { photoLayout } from './piece-geometry.js';
import { levelAspect, useProp, nextPlayableLevel, levelConfig, freshStats } from './progress.js';
import { IdleGuide } from './idle-guide.js';
import { learnGuide, guideMove } from './guide-state.js';
import { loading } from './loading.js';
import { preloadAssets, isPreloaded, warmAssets } from './preload.js';
import { moveGroup, solved, connectionCount, groupFor } from './puzzle.js';
import { SAVE_KEY, THEMES, freshProgress, restoreProgress, faceSize, levelKey, levelArt, initialLayout, isComplete, faceComplete, themeUnlocked, unlockedFaces, currentFace, markComplete } from './progress.js';

mountUI();
const $ = (s) => document.querySelector(s);
const game = $('#game'), overlay = $('#overlay');
let progress = freshProgress();
try { progress = restoreProgress(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch { /* Storage is optional. */ }
const audio = new GameAudio(progress.sound);
let cube, puzzle, guide, mode = 'home', theme = 0, face = 0, session = null, ready = false, busy = true;
let hintWorker, hintVersion = 0, hintDelay, winDelay, overlayFocus;
let winAnimations = [];
let playClock = null;
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch { /* Private browsing remains playable. */ } };
const guarded = (fn) => (...args) => Promise.resolve(fn(...args)).catch(showError);

function syncPlayTime() {
  const now = performance.now();
  if (session && playClock !== null) session.stats.activeMs += now - playClock;
  playClock = session && mode === 'puzzle' && !busy && !session.completed && !document.hidden && overlay.hidden ? now : null;
}
document.addEventListener('visibilitychange', syncPlayTime);

function remember(action) {
  if (learnGuide(progress, action)) { save(); guide?.hide(); }
}
function warmChapter(selectedTheme, selectedFace, afterLevel = -1) {
  if (!themeUnlocked(progress, selectedTheme)) return;
  const count = faceSize(selectedTheme), levels = [];
  for (let step = 1; step <= count; step++) {
    const level = (afterLevel + step) % count;
    if (!isComplete(progress, selectedTheme, selectedFace, level)) levels.push(levelArt(selectedTheme, selectedFace, level));
  }
  warmAssets([THEMES[selectedTheme].faceArt[selectedFace], ...levels.slice(0, 2)]);
}
function guideContext() {
  return {
    key: `${mode}:${theme}:${face}:${session?.level ?? ''}`,
    mode, learned: progress.guides,
    blocked: !ready || busy || cube?.busy || puzzle?.busy || loading.visible || !overlay.hidden || session?.completed,
    canEnter: themeUnlocked(progress, theme),
    hasLevel: mode === 'chapters' && nextPlayableLevel(progress, theme, face) !== null,
    canDrag: mode === 'puzzle' && session && !session.completed,
  };
}
function guideTarget(kind) {
  const rect = game.getBoundingClientRect();
  const stagePoint = (p) => ({ x: (p.x - rect.left) * 1080 / rect.width, y: (p.y - rect.top) * 1920 / rect.height });
  if (kind === 'rotateCube') return { from: { x: 415, y: 980 }, to: { x: 675, y: 850 } };
  if (kind === 'enterChapter') {
    const r = $('#enter').getBoundingClientRect();
    return { from: stagePoint({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) };
  }
  if (kind === 'enterLevel') {
    const level = nextPlayableLevel(progress, theme, face);
    return level === null ? null : { from: stagePoint(cube.tileScreen(face, level)) };
  }
  const move = guideMove(session.positions); if (!move) return null;
  const r = $('#puzzle-board').getBoundingClientRect(), from = puzzle.world(session.positions[move.id]);
  const point = (world) => { const p = puzzle.screen(world); return stagePoint({ x: r.left + p.x * r.width / puzzle.width, y: r.top + p.y * r.height / puzzle.height }); };
  return { from: point(from), to: point({ x: from.x + move.dx, y: from.y - move.dy * puzzle.cellHeight }) };
}

function resize() {
  puzzle?.cancelDrag();
  if (cube) cube.gesture = null;
  const scale = Math.min(innerWidth / 1080, innerHeight / 1920);
  document.documentElement.style.setProperty('--stage-scale', scale);
  // Cover the entire viewport with a little overscan; keep gameplay fully visible.
  document.documentElement.style.setProperty('--background-scale', Math.max(innerWidth / 1080, innerHeight / 1920) * 1.08);
  $('.stage-shell').style.width = `${1080 * scale}px`;
  $('.stage-shell').style.height = `${1920 * scale}px`;
  cube?.resizeRenderers(); puzzle?.resize();
}
window.addEventListener('resize', resize); resize();

function refresh() {
  syncPlayTime();
  if (busy) guide?.hide();
  game.dataset.mode = mode;
  $('.viewport').dataset.theme = theme;
  game.classList.toggle('is-busy', busy);
  $('#back').hidden = mode === 'home'; $('#back').disabled = busy;
  $('#reset-account').hidden = mode !== 'home'; $('#reset-account').disabled = busy || !ready;
  $('#menu-screen').hidden = mode === 'puzzle'; $('#puzzle-screen').hidden = mode !== 'puzzle';
  $('#sound').innerHTML = icon(audio.enabled ? 'sound' : 'mute');
  $('#sound').setAttribute('aria-label', audio.enabled ? '关闭音效' : '开启音效');
  $('#sound').setAttribute('aria-pressed', String(audio.enabled));
  if (mode === 'puzzle') {
    const size = Math.sqrt(session.positions.length), value = connectionCount(session.positions) / (2 * size * (size - 1));
    $('#puzzle-fill').style.width = `${value * 100}%`;
    $('.puzzle-progress').setAttribute('aria-valuenow', Math.round(value * 100));
    for (const [type, selector] of [['hint', '#hint'], ['preview', '#picture-peek']]) {
      const count = progress.props[type], button = $(selector);
      button.disabled = busy || session.completed || count === 0;
      button.setAttribute('aria-label', `${type === 'hint' ? '提示一步' : '查看原图'}，剩余 ${count} 次`);
      $(`#${type}-count`).textContent = count;
    }
    $('#level-progress').innerHTML = Array.from({ length: faceSize(theme) }, (_, i) => `<span class="level-dot ${i === session.level ? 'active' : ''} ${isComplete(progress, theme, face, i) ? 'done' : ''}"></span>`).join('');
    return;
  }
  const chapters = mode === 'chapters', unlocked = themeUnlocked(progress, theme), count = unlockedFaces(progress, theme);
  $('#cube-host').setAttribute('aria-label', chapters ? '点击图块进入关卡，使用左右箭头翻面' : '拖动旋转魔方，点击进入章节');
  $('#theme-medallion').hidden = chapters; $('.medallion-stars').hidden = chapters;
  const art = THEME_ART[theme];
  $('#theme-medallion').innerHTML = icon(art.icon);
  $('.top-emblem').innerHTML = icon(art.icon);
  game.style.setProperty('--theme-panel', art.panel);
  game.style.setProperty('--theme-border', art.border);
  game.style.setProperty('--theme-ink', art.ink);
  game.style.setProperty('--theme-shadow', art.stripe);
  $('#face-progress').hidden = theme === 2;
  $('#enter').hidden = chapters; $('#enter').disabled = busy;
  $('#enter').classList.toggle('locked', !unlocked);
  $('#enter').innerHTML = icon(unlocked ? 'play' : theme === 2 ? 'hourglass' : 'lock');
  $('#theme-pages').hidden = chapters; $('#chapter-pages').hidden = !chapters;
  $('#theme-pages').innerHTML = THEMES.map((t, i) => `<button class="theme-page ${i === theme ? 'active' : ''}" data-theme="${i}" aria-label="${t.order}阶魔方${i === 2 ? '，敬请期待' : !themeUnlocked(progress, i) ? '，未解锁' : ''}" aria-pressed="${i === theme}" ${busy ? 'disabled' : ''}>${gridIcon(t.order)}</button>`).join('');
  $('#chapter-pages').innerHTML = Array.from({ length: 6 }, (_, i) => `<button class="chapter-page ${i === face ? 'active' : ''} ${faceComplete(progress, theme, i) ? 'done' : ''}" data-face="${i}" aria-label="第${i + 1}面${i >= count ? '，未解锁' : ''}" aria-pressed="${i === face}" ${i >= count || busy ? 'disabled' : ''}>${icon(i >= count ? 'lock' : faceComplete(progress, theme, i) ? 'check' : 'cube')}</button>`).join('');
  $('#face-progress').innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="face-pip ${faceComplete(progress, theme, i) ? 'done' : i === (chapters ? face : currentFace(progress, theme)) && unlocked ? 'current' : ''}">${icon(faceComplete(progress, theme, i) ? 'check' : i < count ? 'cube' : 'lock')}</span>`).join('');
  $('#previous').disabled = busy || (chapters && count < 2); $('#next').disabled = $('#previous').disabled;
  $('#chapter-targets').hidden = !chapters;
  $('#chapter-targets').style.setProperty('--order', THEMES[theme].order);
  $('#chapter-targets').innerHTML = chapters ? Array.from({ length: faceSize(theme) }, (_, i) => `<button class="tile-focus" data-level="${i}" aria-label="第${i + 1}关${isComplete(progress, theme, face, i) ? '，已完成' : ''}" ${busy ? 'disabled' : ''}></button>`).join('') : '';
}

function lockedFeedback() {
  const target = $('#enter'); target.classList.remove('lock-bump');
  void target.offsetWidth; target.classList.add('lock-bump');
  setTimeout(() => target.classList.remove('lock-bump'), 450);
}

async function selectTheme(next, direction = 1) {
  if (!ready || busy || mode !== 'home' || next === theme) return;
  busy = true; theme = next; face = 0; refresh(); audio.play('move');
  await cube.switchTheme(theme, direction); busy = false; refresh();
}
async function navigate(direction) {
  if (!ready || busy || mode === 'puzzle') return;
  if (mode === 'home') return selectTheme((theme + direction + 3) % 3, direction);
  const count = unlockedFaces(progress, theme);
  if (count < 2) return;
  return selectFace((face + direction + count) % count);
}
async function selectFace(next) {
  if (busy || mode !== 'chapters' || next === face || next >= unlockedFaces(progress, theme) || next < 0) return;
  busy = true; refresh(); audio.play('move'); await cube.turn(next); face = next; busy = false; refresh();
  warmChapter(theme, face);
}
async function enterCube() {
  if (!ready || busy || mode !== 'home') return;
  if (!themeUnlocked(progress, theme)) { lockedFeedback(); return; }
  remember('enterChapter');
  busy = true; mode = 'chapters'; face = currentFace(progress, theme); refresh();
  audio.unlock(); await cube.enter(face); busy = false; refresh();
  warmChapter(theme, face);
}
async function back() {
  if (busy || !ready) return;
  if (!overlay.hidden) { if (session?.completed) await leavePuzzle(); else closeOverlay(); return; }
  if (mode === 'puzzle') return leavePuzzle();
  if (mode === 'chapters') {
    busy = true; refresh(); await cube.leave(); mode = 'home'; busy = false; refresh();
  }
}

function savePuzzle() {
  if (!session || session.completed) return;
  syncPlayTime();
  progress.puzzles[levelKey(theme, face, session.level)] = {
    positions: [...session.positions], gridSize: Math.sqrt(session.positions.length),
    layoutVersion: session.layoutVersion, stats: { ...session.stats, activeMs: Math.round(session.stats.activeMs) },
  }; save();
}
async function enterLevel(level) {
  if (busy || mode !== 'chapters' || face >= unlockedFaces(progress, theme) || level < 0 || level >= faceSize(theme)) return;
  remember('enterLevel');
  busy = true; mode = 'puzzle'; cube.active = false;
  const saved = progress.puzzles[levelKey(theme, face, level)];
  session = { level, art: levelArt(theme, face, level), positions: saved?.positions ?? initialLayout(theme, face, level),
    layoutVersion: saved?.layoutVersion ?? levelConfig(theme, face, level).layoutVersion,
    stats: saved?.stats ? { ...saved.stats } : freshStats(), completed: false, unlock: null };
  $('#puzzle-board').replaceChildren();
  const aspect = levelAspect(theme, face, level), layout = photoLayout(aspect);
  for (const [key, value] of Object.entries(layout)) $('.puzzle-frame').style[key] = `${value}px`;
  refresh();
  const ticket = loading.begin(isPreloaded(session.art) ? 120 : 0);
  await preloadAssets([session.art], (fraction) => ticket.progress(fraction * .9));
  puzzle = new PuzzleRenderer($('#puzzle-board'), session.positions, {
    onGrab: () => audio.unlock(), onDrag: () => remember('dragPuzzle'), onDrop: guarded(applyMove),
    onReady: () => { ticket.progress(1); ticket.finish(); },
  }, theme);
  await puzzle.init(session.art); busy = false; refresh();
  warmChapter(theme, face, level);
}

async function applyMove(id, dx, dy, fromHint = false) {
  if (mode !== 'puzzle' || session.completed || (busy && !fromHint)) return;
  const next = moveGroup(session.positions, id, dx, dy);
  if (next.every((p, i) => p === session.positions[i])) { await puzzle.setPositions(session.positions); busy = false; puzzle.setBlocked(false); refresh(); return; }
  // Commit a hint only when it actually changes the board, together with its save.
  if (fromHint && !useProp(progress, 'hint')) { busy = false; puzzle.setBlocked(false); refresh(); return; }
  busy = true; puzzle.setBlocked(true);
  syncPlayTime(); session.stats.moves++; if (fromHint) session.stats.hints++;
  const previousGroup = groupFor(session.positions, id), connectedGroup = groupFor(next, id);
  session.positions = next; session.completed = solved(next);
  if (session.completed) {
    session.unlock = markComplete(progress, theme, face, session.level);
    progress.records[levelKey(theme, face, session.level)] = { ...session.stats, activeMs: Math.round(session.stats.activeMs),
      gridSize: Math.sqrt(next.length), layoutVersion: session.layoutVersion, completedAt: Date.now() };
    save();
  }
  else savePuzzle();
  refresh(); await puzzle.setPositions(next);
  if (connectedGroup.some((piece) => !previousGroup.includes(piece))) { puzzle.flashGroup(connectedGroup); audio.play('merge'); }
  else audio.play('move');
  busy = false; puzzle.setBlocked(session.completed); refresh();
  if (session.completed) {
    audio.play('win'); puzzle.celebrate();
    winDelay = setTimeout(guarded(showWin), 2000);
  }
}

async function leavePuzzle() {
  if (mode !== 'puzzle' || busy) return;
  busy = true; clearTimeout(winDelay); clearTimeout(hintDelay); hintVersion++; hintWorker?.terminate(); hintWorker = null;
  savePuzzle(); closeOverlay(); const finished = session.completed, level = session.level, unlock = session.unlock;
  puzzle.destroy(); puzzle = null; session = null; mode = 'chapters'; cube.active = true; refresh();
  if (finished) {
    await cube.reveal(face, level);
    if (unlock?.newFace) {
      await cube.showcase(unlock.newTheme ? 'theme' : 'chapter');
      if (unlock.newTheme && theme === 0) {
        await cube.leave(); mode = 'home'; theme = 1; face = 0; refresh();
        await cube.switchTheme(1, 1); cube.celebrate(true);
      } else if (face < 5) { await cube.turn(face + 1); face++; }
    }
  }
  busy = false; refresh();
}

function showOverlay(html, name) {
  guide?.hide();
  if (cube) cube.gesture = null;
  overlayFocus = document.activeElement; $('#overlay-content').innerHTML = html; overlay.hidden = false;
  overlay.setAttribute('aria-label', name); $('#menu-screen').inert = true; $('#puzzle-screen').inert = true; $('.top-bar').inert = true;
  puzzle?.setBlocked(true); overlay.querySelector('button')?.focus({ preventScroll: true });
  syncPlayTime();
}
function closeOverlay() {
  winAnimations.forEach((animation) => animation.cancel()); winAnimations = [];
  overlay.removeAttribute('aria-busy');
  overlay.hidden = true; $('#menu-screen').inert = false; $('#puzzle-screen').inert = false; $('.top-bar').inert = false;
  if (puzzle) puzzle.setBlocked(busy || session?.completed); overlayFocus?.focus?.({ preventScroll: true });
  syncPlayTime();
}
async function showWin() {
  if (!session?.completed || mode !== 'puzzle') return;
  const finishedSession = session;
  busy = true; refresh();
  showOverlay(`<div class="overlay-card win-card"><div class="win-mark">${icon('check')}</div><img src="${levelArt(theme, face, session.level)}" alt="已完成的拼图"/><div class="star-row">${icon('spark')}${icon('spark')}${icon('spark')}</div><button id="continue" class="icon-button next-level" aria-label="返回魔方并揭开图块" disabled>${icon('arrow')}</button></div>`, '拼图完成');
  overlay.setAttribute('aria-busy', 'true');
  const timing = { duration: 1000, easing: 'cubic-bezier(.22, 1, .36, 1)' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  winAnimations = [
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, easing: 'ease-out' }),
    $('.win-card').animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
      { opacity: 0, transform: 'translateY(38px) scale(.92)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], timing),
  ];
  await Promise.all(winAnimations.map((animation) => animation.finished.catch(() => {})));
  if (session !== finishedSession || overlay.hidden) return;
  winAnimations = []; overlay.removeAttribute('aria-busy');
  busy = false; refresh(); $('#continue').disabled = false;
  $('#continue').focus({ preventScroll: true });
}
function showError(error) {
  if (error?.code === 'RESOURCE_RESET') return;
  console.error(error); busy = true; refresh();
  loading.fail(error);
}

function confirmAccountReset() {
  if (!ready || busy || cube.busy || mode !== 'home' || !overlay.hidden) return;
  showOverlay(`<div class="overlay-card reset-card"><div class="reset-mark" aria-hidden="true">${icon('reset')}</div><h2>Reset account?</h2><p>All progress and records will be lost.<br>Items, sound and guides will reset.<br>This cannot be undone.</p><div class="reset-actions"><button id="cancel-reset" class="icon-button reset-action" aria-label="Cancel reset">${icon('close')}</button><button id="confirm-reset" class="icon-button reset-action reset-confirm" aria-label="Confirm account reset">${icon('check')}</button></div></div>`, 'Reset account confirmation');
}
async function resetAccount() {
  if (!ready || busy || mode !== 'home') return;
  busy = true;
  progress = freshProgress(); audio.enabled = progress.sound;
  // Replace the in-memory save too, so pagehide cannot write old progress back.
  save(); cube.resetProgress(progress);
  const previousTheme = theme; theme = 0; face = 0;
  closeOverlay(); refresh();
  if (previousTheme !== 0) await cube.switchTheme(0, -1);
  busy = false; refresh(); $('#reset-account').focus({ preventScroll: true });
  warmChapter(0, 0);
}

$('#sound').addEventListener('click', () => { audio.enabled = !audio.enabled; audio.unlock(); progress.sound = audio.enabled; save(); audio.play('move'); refresh(); });
$('#reset-account').addEventListener('click', confirmAccountReset);
$('#previous').addEventListener('click', guarded(() => navigate(-1)));
$('#next').addEventListener('click', guarded(() => navigate(1)));
$('#back').addEventListener('click', guarded(back));
$('#enter').addEventListener('click', guarded(enterCube));
$('#theme-pages').addEventListener('click', guarded((e) => { const b = e.target.closest('[data-theme]'); if (b) return selectTheme(Number(b.dataset.theme), Number(b.dataset.theme) > theme ? 1 : -1); }));
$('#chapter-pages').addEventListener('click', guarded((e) => { const b = e.target.closest('[data-face]'); if (b && !b.disabled) return selectFace(Number(b.dataset.face)); }));
$('#chapter-targets').addEventListener('click', guarded((e) => { const b = e.target.closest('[data-level]'); if (b) return enterLevel(Number(b.dataset.level)); }));
$('#picture-peek').addEventListener('click', () => {
  if (busy || !session || session.completed || !overlay.hidden || !useProp(progress, 'preview')) return;
  session.stats.previews++; savePuzzle(); refresh();
  showOverlay(`<div class="overlay-card"><button id="close-picture" class="icon-button overlay-close" aria-label="关闭原图">${icon('close')}</button><img src="${session.art}" alt="完整原图"/></div>`, '原图');
});
function activateOverlayButton(button) {
  if (overlay.hidden || busy || !button) return;
  if (button.id === 'continue') return leavePuzzle();
  if (button.id === 'confirm-reset') return resetAccount();
  if (button.id === 'close-picture' || button.id === 'cancel-reset') closeOverlay();
}
const overlayContent = $('#overlay-content');
let overlayPress = null;
overlayContent.addEventListener('pointerdown', (e) => {
  const button = e.target.closest('button');
  overlayPress = e.pointerType !== 'mouse' && button ? { button, id: e.pointerId, x: e.clientX, y: e.clientY } : null;
});
overlayContent.addEventListener('pointercancel', () => { overlayPress = null; });
overlayContent.addEventListener('pointerup', guarded((e) => {
  const press = overlayPress; overlayPress = null;
  if (!press || press.id !== e.pointerId || press.button !== e.target.closest('button') || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) return;
  // Some mobile browsers omit the compatibility click after captured canvas
  // drags. A complete touch/pen tap activates directly; hidden/busy guards keep
  // any subsequent click from activating the same action a second time.
  return activateOverlayButton(press.button);
}));
overlayContent.addEventListener('click', guarded((e) => activateOverlayButton(e.target.closest('button'))));
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!session?.completed) closeOverlay(); }
});
window.addEventListener('keydown', guarded((e) => {
  if (mode === 'puzzle' || !overlay.hidden) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); return navigate(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); return navigate(1); }
  if (e.key === 'Escape') return back();
}));
$('#hint').addEventListener('click', () => {
  if (busy || !session || session.completed || !overlay.hidden || progress.props.hint <= 0) return;
  busy = true; puzzle.setBlocked(true); refresh(); const version = ++hintVersion;
  hintWorker = new Worker(new URL('./hint.worker.js', import.meta.url), { type: 'module' });
  hintWorker.onmessage = ({ data }) => {
    hintWorker?.terminate(); hintWorker = null;
    if (version !== hintVersion || mode !== 'puzzle') return;
    if (!data.hint) { busy = false; puzzle.setBlocked(false); refresh(); return; }
    puzzle.showHint(data.hint);
    hintDelay = setTimeout(guarded(() => applyMove(data.hint.id, data.hint.dx, data.hint.dy, true)), puzzle.reducedMotion ? 1 : 650);
  };
  hintWorker.onerror = (error) => { console.error(error); hintWorker?.terminate(); hintWorker = null; busy = false; puzzle.setBlocked(false); refresh(); };
  hintWorker.postMessage({ positions: session.positions, version });
});
window.addEventListener('pagehide', () => { savePuzzle(); save(); });

async function init() {
  refresh();
  cube = new CubeScene($('#cube-host'), progress, { onEnter: guarded(enterCube), onLevel: guarded(enterLevel), onRotate: () => remember('rotateCube') });
  await cube.init();
  guide = new IdleGuide($('#hand-guide'), guideContext, guideTarget);
  ready = true; busy = false; refresh();
  warmChapter(0, currentFace(progress, 0), (nextPlayableLevel(progress, 0, currentFace(progress, 0)) ?? 0));
  if (import.meta.env.DEV) window.__game = {
    state: () => structuredClone({ mode, theme, face, busy, ready, progress, session }),
    idle: () => ready && !busy && !cube.busy && (!puzzle || !puzzle.busy),
    cubePose: () => ({ quaternion: cube.current.quaternion.toArray(), scale: cube.current.scale.x, mode: cube.mode }),
    arrowColors: () => cube.arrows.map((arrow) => arrow.material.color.getHexString()),
    celebration: () => puzzle?.particles.length ?? 0,
    tileCenter: (level) => cube.tileScreen(face, level),
    pieceCenter: (id) => {
      const r = $('#puzzle-board').getBoundingClientRect(), p = puzzle.screen(puzzle.world(session.positions[id]));
      return { x: r.left + p.x * r.width / puzzle.width, y: r.top + p.y * r.height / puzzle.height };
    },
    cellCenter: (cell) => {
      const r = $('#puzzle-board').getBoundingClientRect(), p = puzzle.screen(puzzle.world(cell));
      return { x: r.left + p.x * r.width / puzzle.width, y: r.top + p.y * r.height / puzzle.height };
    },
    revealed: () => cube.tiles[theme].filter((t) => t.userData.complete).map((t) => ({ face: t.userData.face, level: t.userData.level })),
    puzzleGeometry: () => puzzle && ({ aspect: puzzle.aspect, width: puzzle.width, height: puzzle.height, cards: puzzle.cards.map((c) => ({ position: c.mesh.position.toArray(), scale: c.mesh.scale.toArray(), rotation: c.mesh.rotation.toArray().slice(0, 3), vertices: [...c.picture.geometry.attributes.position.array], uv: [...c.picture.geometry.attributes.uv.array], flash: c.flash.material.opacity })) }),
    entrance: () => puzzle?.animation?.intro ? { elapsed: performance.now() - puzzle.animation.start, duration: puzzle.animation.duration, cards: structuredClone(puzzle.animation.introPlan) } : null,
  };
}
if (import.meta.hot) import.meta.hot.dispose(() => { clearTimeout(winDelay); clearTimeout(hintDelay); closeOverlay(); hintWorker?.terminate(); guide?.destroy(); puzzle?.destroy(); cube?.destroy(); audio.destroy(); });
export async function startGame() { await init(); }
