import './style.css';
import './background.css';
import { mountUI } from './ui.js';
import { bindButtonTap } from './button-tap.js';
import { mountModeSwitch } from './mode-switch.js';
import { createJigsaw, jigsawConfig } from './jigsaw.js';
import { restoreAccount, serializeAccount, jigsawUnlocked, selectAccountMode, shouldGuideModeSwitch, resetSelectedMode } from './gameplay-progress.js';
import { TEST_CONTROLS } from './build-flags.js';
import { icon, gridIcon } from './icons.js';
import { CubeScene } from './cube-scene.js';
import { PuzzleRenderer } from './renderer.js';
import { GameAudio } from './audio.js';
import { bindNativeApp } from './native-app.js';
import { THEME_ART } from './theme-art.js';
import jigsawMedallion from './jigsaw-medallion.svg?raw';
import { photoLayout } from './piece-geometry.js';
import { levelAspect, useProp, nextPlayableLevel, levelConfig, freshStats, completeAllLevels } from './progress.js';
import { IdleGuide } from './idle-guide.js';
import { learnGuide, guideMove } from './guide-state.js';
import { loading } from './loading.js';
import { loadImageAsset } from './preload.js';
import { moveGroup, solved, connectionCount, newlyConnectedGroups } from './puzzle.js';
import { SAVE_KEY, THEMES, faceSize, levelKey, levelArt, initialLayout, isComplete, faceComplete, themeComplete, themeUnlocked, unlockedFaces, currentTheme, currentFace, markComplete } from './progress.js';

mountUI();
const $ = (s) => document.querySelector(s);
const game = $('#game'), overlay = $('#overlay');
let stored;
try { stored = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* Storage is optional. */ }
const account = restoreAccount(stored);
let progress = account[account.selected];
const inJigsaw = () => account.selected === 'B';
const audio = new GameAudio(progress.sound);
let cube, puzzle, guide, mode = 'home', theme = currentTheme(progress), face = currentFace(progress, theme), session = null, ready = false, busy = true;
let hintWorker, hintVersion = 0, hintDelay, winDelay, overlayFocus;
let winAnimations = [];
let settingsOpen = false;
let settingsMode = null;
let requestedTheme = null;
let playClock = null;
let levelImage = null;
let nativeActive = true, disposeNative = () => {};
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(serializeAccount(account))); } catch { /* Private browsing remains playable. */ } };
const guarded = (fn) => (...args) => Promise.resolve(fn(...args)).catch(showError);
const modeSwitch = mountModeSwitch($('.top-bar'), guarded(selectGameplay));

function syncPlayTime() {
  const now = performance.now();
  if (session && playClock !== null) session.stats.activeMs += now - playClock;
  playClock = session && mode === 'puzzle' && !busy && !settingsOpen && !session.completed && nativeActive && !document.hidden && overlay.hidden ? now : null;
}
function syncAppActivity() {
  syncPlayTime();
  const active = nativeActive && !document.hidden;
  audio.setActive(active);
  if (!active) {
    savePuzzle(); save(); guide?.hide(); puzzle?.cancelDrag();
    cube?.cancelGesture();
  }
}
document.addEventListener('visibilitychange', syncAppActivity);

function remember(action) {
  if (learnGuide(progress, action)) { save(); guide?.hide(); }
}
function guideContext() {
  const latestFace = mode === 'chapters' ? currentFace(progress, theme) : null;
  const emptyEdgeTray = puzzle?.emptyEdgeTray;
  return {
    key: `${account.selected}:${mode}:${theme}:${face}:${session?.level ?? ''}:${modeSwitch.open}`,
    mode, learned: progress.guides,
    blocked: !ready || !nativeActive || busy || settingsOpen || cube?.busy || puzzle?.busy || loading.visible || !overlay.hidden
      || session?.completed || (inJigsaw() && (puzzle?.previewing || puzzle?.keyboard)),
    suggestModeSwitch: mode === 'home' && shouldGuideModeSwitch(account),
    modeSwitchOpen: modeSwitch.open,
    canEnter: themeUnlocked(progress, theme),
    hasLevel: mode === 'chapters' && nextPlayableLevel(progress, theme, face) !== null,
    canSwitchFace: mode === 'chapters' && face !== latestFace && nextPlayableLevel(progress, theme, latestFace) !== null,
    canDrag: mode === 'puzzle' && !!puzzle && !emptyEdgeTray,
    emptyEdgeTray,
  };
}
function guideTarget(kind) {
  const rect = game.getBoundingClientRect();
  const stagePoint = (p) => ({ x: (p.x - rect.left) * 1080 / rect.width, y: (p.y - rect.top) * 1920 / rect.height });
  if (kind === 'rotateCube') return { from: { x: 415, y: 980 }, to: { x: 675, y: 850 } };
  const buttonSelector = {
    enterChapter: '#enter', clearEdgeFilter: '.jb-filter', openModeSwitch: '#mode-switch', selectAlternateMode: '#mode-switch-alternate',
    switchFace: `#chapter-pages [data-face="${currentFace(progress, theme)}"]`,
  }[kind];
  if (buttonSelector) {
    const r = $(buttonSelector).getBoundingClientRect();
    return { from: stagePoint({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) };
  }
  if (kind === 'enterLevel') {
    const level = nextPlayableLevel(progress, theme, face);
    return level === null ? null : { from: stagePoint(cube.tileScreen(face, level)) };
  }
  if (inJigsaw()) {
    const path = puzzle.guideDragPath();
    return path && { from: stagePoint(path.from), to: stagePoint(path.to) };
  }
  const move = guideMove(session.positions); if (!move) return null;
  const r = $('#puzzle-board').getBoundingClientRect(), from = puzzle.world(session.positions[move.id]);
  const point = (world) => { const p = puzzle.screen(world); return stagePoint({ x: r.left + p.x * r.width / puzzle.width, y: r.top + p.y * r.height / puzzle.height }); };
  return { from: point(from), to: point({ x: from.x + move.dx, y: from.y - move.dy * puzzle.cellHeight }) };
}

let resizeFrame, viewportWidth, viewportHeight;
function resize() {
  resizeFrame = null;
  const viewport = $('.viewport'), style = getComputedStyle(viewport);
  const fullWidth = viewport.clientWidth, fullHeight = viewport.clientHeight;
  const width = fullWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = fullHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (width <= 0 || height <= 0 || document.hidden) return;
  // The window can change size while its cutout-safe content area stays the same.
  document.documentElement.style.setProperty('--background-scale', Math.max(fullWidth / 1080, fullHeight / 1920) * 1.08);
  if (width !== viewportWidth || height !== viewportHeight) {
    puzzle?.cancelDrag(); cube?.cancelGesture();
    viewportWidth = width; viewportHeight = height;
    const scale = Math.min(width / 1080, height / 1920);
    document.documentElement.style.setProperty('--stage-scale', scale);
    $('.stage-shell').style.width = `${1080 * scale}px`;
    $('.stage-shell').style.height = `${1920 * scale}px`;
  }
  cube?.resizeRenderers(); puzzle?.resize();
}
const queueResize = () => { if (resizeFrame == null) resizeFrame = requestAnimationFrame(resize); };
window.addEventListener('resize', queueResize); resize();
document.addEventListener('visibilitychange', queueResize);
const viewportObserver = new ResizeObserver(queueResize);
viewportObserver.observe($('.viewport'));

function updateModeSwitch() {
  modeSwitch.update({ mode: account.selected, visible: mode === 'home', unlocked: jigsawUnlocked(account),
    disabled: busy || !ready || settingsOpen || !overlay.hidden });
}
function setSettingsOpen(open, restoreFocus = false) {
  if (open && (!ready || busy || cube?.busy || !overlay.hidden)) return;
  if (settingsOpen === open) return;
  settingsOpen = open;
  updateModeSwitch();
  settingsMode = open ? mode : null;
  $('.puzzle-settings').classList.toggle('is-open', open);
  $('#settings').setAttribute('aria-expanded', String(open));
  $('#settings-menu').setAttribute('aria-hidden', String(!open));
  $('#settings-menu').inert = !open;
  $('#menu-screen').inert = open || !overlay.hidden;
  puzzle?.setBlocked(open || busy || session?.completed || !overlay.hidden);
  guide?.hide(); syncPlayTime();
  if (open) $(mode === 'puzzle' ? '#back' : '#sound').focus({ preventScroll: true });
  else if (restoreFocus) $('#settings').focus({ preventScroll: true });
}

function refreshThemePages() {
  const pages = $('#theme-pages');
  if (!pages.children.length) pages.innerHTML = THEMES.map((t, i) =>
    `<button class="theme-page" data-theme="${i}">${gridIcon(t.order)}</button>`).join('');
  const selected = requestedTheme?.next ?? theme;
  THEMES.forEach((t, i) => {
    const button = pages.children[i];
    button.classList.toggle('active', selected === i);
    button.setAttribute('aria-pressed', String(selected === i));
    button.setAttribute('aria-label', `${t.order}阶魔方${t.comingSoon ? '，敬请期待' : !themeUnlocked(progress, i) ? '，未解锁' : ''}`);
    button.disabled = busy && !requestedTheme;
  });
}

function refreshPuzzleToolbar() {
  const jigsaw = inJigsaw(), previewing = jigsaw && !!puzzle?.previewing;
  let max = 100, value;
  if (jigsaw) {
    max = session.board.cols * session.board.rows;
    value = puzzle?.model.placedCount ?? 0;
  } else {
    const size = Math.sqrt(session.positions.length);
    value = max * connectionCount(session.positions) / (2 * size * (size - 1));
  }
  $('#puzzle-fill').style.width = `${100 * value / max}%`;
  $('.puzzle-progress').setAttribute('aria-valuenow', Math.round(value));
  $('.puzzle-progress').setAttribute('aria-valuemax', max);
  const preview = $('#picture-peek');
  if (jigsaw) preview.setAttribute('aria-pressed', String(previewing));
  else preview.removeAttribute('aria-pressed');
  for (const [type, button] of [['hint', $('#hint')], ['preview', preview]]) {
    const count = progress.props[type], canClose = type === 'preview' && previewing;
    button.disabled = busy || session.completed || (!canClose && (count === 0 || previewing));
    if (jigsaw) {
      const name = type === 'hint' ? '自动拼上一片' : '查看完成图';
      button.setAttribute('aria-label', canClose ? '返回拼图' : `${name}，剩余 ${count} 个`);
    } else {
      button.setAttribute('aria-label', `${type === 'hint' ? 'Hint' : 'Preview'}, ${count} left`);
    }
    $(`#${type}-count`).textContent = count;
  }
}

function refresh() {
  syncPlayTime();
  if (busy) guide?.hide();
  game.dataset.mode = mode;
  $('.viewport').dataset.theme = theme;
  game.classList.toggle('is-busy', busy);
  const inPuzzle = mode === 'puzzle';
  if (busy || settingsOpen && settingsMode !== mode) setSettingsOpen(false);
  updateModeSwitch();
  // The same back button moves between the chapter footer and puzzle settings.
  const backParent = inPuzzle ? $('#settings-menu') : $('#menu-screen');
  if ($('#back').parentElement !== backParent) {
    if (inPuzzle) backParent.prepend($('#back'));
    else backParent.append($('#back'));
  }
  $('#back').classList.toggle('icon-button', mode !== 'chapters');
  $('#back').classList.toggle('play-button', mode === 'chapters');
  $('#back').classList.toggle('chapter-back', mode === 'chapters');
  $('.puzzle-tools').hidden = !inPuzzle; $('.puzzle-progress').hidden = !inPuzzle;
  $('.puzzle-frame').hidden = inJigsaw(); $('#jigsaw-workspace').hidden = !inPuzzle || !inJigsaw();
  $('#settings').disabled = busy || !ready;
  $('#back').hidden = mode === 'home'; $('#back').disabled = busy;
  if (TEST_CONTROLS) for (const [selector, label] of [
    ['#reset-account', `Reset mode ${account.selected}`], ['#complete-all', `Complete all levels in mode ${account.selected}`],
  ]) {
    const button = $(selector);
    button.hidden = mode !== 'home'; button.disabled = busy || !ready;
    button.title = label; button.setAttribute('aria-label', label);
  }
  $('#menu-screen').hidden = mode === 'puzzle'; $('#puzzle-screen').hidden = mode !== 'puzzle';
  $('#sound').innerHTML = icon(audio.enabled ? 'sound' : 'mute');
  $('#sound').setAttribute('aria-label', audio.enabled ? 'Sound off' : 'Sound on');
  $('#sound').setAttribute('aria-pressed', String(audio.enabled));
  if (mode === 'puzzle') {
    refreshPuzzleToolbar();
    return;
  }
  const chapters = mode === 'chapters', unlocked = themeUnlocked(progress, theme), count = unlockedFaces(progress, theme);
  $('#cube-host').setAttribute('aria-label', chapters ? '点击图块进入关卡，使用左右箭头翻面' : '拖动旋转魔方，点击进入章节');
  $('#theme-medallion').hidden = chapters; $('.medallion-stars').hidden = chapters;
  const art = THEME_ART[theme];
  $('#theme-medallion').innerHTML = (inJigsaw() ? jigsawMedallion : '') + icon(art.icon);
  $('.top-emblem').innerHTML = icon(art.icon);
  game.style.setProperty('--theme-panel', art.panel);
  game.style.setProperty('--theme-border', art.border);
  game.style.setProperty('--theme-ink', art.ink);
  game.style.setProperty('--theme-shadow', art.stripe);
  const faceProgress = $('#face-progress');
  faceProgress.hidden = chapters || !!THEMES[theme].comingSoon;
  if (!faceProgress.hidden) {
    const faces = Array.from({ length: 6 }, (_, i) => faceComplete(progress, theme, i));
    const completed = faces.filter(Boolean).length;
    const current = unlocked ? currentFace(progress, theme) : -1;
    faceProgress.innerHTML = faces.map((done, i) => {
      const state = done ? 'done' : i === current ? 'current' : '';
      return `<span class="face-pip ${state}" aria-hidden="true"></span>`;
    }).join('');
    faceProgress.setAttribute('aria-valuenow', completed);
    faceProgress.setAttribute('aria-valuetext', `已完成 ${completed} / 6 面${current >= 0 && !faces[current] ? `，当前第 ${current + 1} 面` : ''}`);
  }
  $('#chapter-progress').hidden = !chapters;
  if (chapters) {
    const total = faceSize(theme), completed = Array.from({ length: total }, (_, i) => isComplete(progress, theme, face, i)).filter(Boolean).length;
    $('#chapter-progress').innerHTML = Array.from({ length: total }, (_, i) => `<span class="chapter-dot ${isComplete(progress, theme, face, i) ? 'done' : ''}" aria-hidden="true"></span>`).join('');
    $('#chapter-progress').setAttribute('aria-valuemax', total);
    $('#chapter-progress').setAttribute('aria-valuenow', completed);
    $('#chapter-progress').setAttribute('aria-valuetext', `${completed} / ${total}`);
  }
  $('#enter').hidden = chapters; $('#enter').disabled = busy;
  $('#enter').classList.toggle('locked', !unlocked);
  $('#enter').innerHTML = icon(unlocked ? 'play' : THEMES[theme].comingSoon ? 'hourglass' : 'lock');
  $('#theme-pages').hidden = chapters; $('#chapter-pages').hidden = !chapters;
  refreshThemePages();
  $('#chapter-pages').innerHTML = Array.from({ length: 6 }, (_, i) => {
    const locked = i >= count;
    const done = !locked && faceComplete(progress, theme, i);
    // The preview atlas has one row per theme and one column per face.
    const thumbnail = done ? `style="background-position: ${i * 20}% ${theme * 50}%"` : '';
    const label = `第${i + 1}面${locked ? '，未解锁' : done ? '，已完成' : ''}`;
    return `<button class="chapter-page ${i === face ? 'active' : ''} ${done ? 'done' : ''}" data-face="${i}" ${thumbnail}
      aria-label="${label}" aria-pressed="${i === face}" ${locked || busy ? 'disabled' : ''}>${done ? '' : icon(locked ? 'lock' : 'cube')}</button>`;
  }).join('');
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
  if (!ready || mode !== 'home' || (busy && !requestedTheme) || next === (requestedTheme?.next ?? theme)) return;
  requestedTheme = { next, direction };
  if (busy) { refreshThemePages(); return; }
  busy = true;
  try {
    while (theme !== requestedTheme.next) {
      const target = requestedTheme;
      theme = target.next; face = currentFace(progress, theme);
      refresh(); audio.play('move');
      await cube.switchTheme(theme, target.direction);
    }
  } finally {
    requestedTheme = null; busy = false; refresh();
  }
}
async function selectGameplay(next) {
  if (!ready || busy || cube.busy || settingsOpen || !overlay.hidden || mode !== 'home') return;
  if (!selectAccountMode(account, next)) return;
  const previousTheme = theme;
  busy = true;
  progress = account[next]; audio.enabled = progress.sound;
  theme = currentTheme(progress); face = currentFace(progress, theme);
  cube.resetProgress(progress, account.selected);
  save(); refresh(); audio.play('move');
  if (previousTheme !== theme) await cube.switchTheme(theme, theme > previousTheme ? 1 : -1);
  busy = false; refresh();
}
async function navigate(direction) {
  if (!ready || busy || mode === 'puzzle') return;
  if (mode === 'home') return selectTheme((theme + direction + THEMES.length) % THEMES.length, direction);
  const count = unlockedFaces(progress, theme);
  if (count < 2) return;
  return selectFace((face + direction + count) % count);
}
async function selectFace(next) {
  if (busy || mode !== 'chapters' || next === face || next >= unlockedFaces(progress, theme) || next < 0) return;
  busy = true; refresh(); audio.play('move'); await cube.turn(next); face = next; busy = false; refresh();
}
async function enterCube() {
  if (!ready || busy || mode !== 'home') return;
  if (!themeUnlocked(progress, theme)) { lockedFeedback(); return; }
  remember('enterChapter');
  busy = true; mode = 'chapters'; face = themeComplete(progress, theme) ? cube.frontFace() : currentFace(progress, theme); refresh();
  audio.unlock(); await cube.enter(face); busy = false; refresh();
}
async function back() {
  if (busy || !ready) return;
  setSettingsOpen(false);
  if (!overlay.hidden) { if (session?.completed) await leavePuzzle(); else closeOverlay(); return; }
  if (mode === 'puzzle') return leavePuzzle();
  if (mode === 'chapters') {
    busy = true; refresh(); await cube.leave(); mode = 'home'; busy = false; refresh();
  }
}

function savePuzzle() {
  if (!session || session.completed) return;
  syncPlayTime();
  const state = inJigsaw() ? { board: session.board } : {
    positions: [...session.positions], gridSize: Math.sqrt(session.positions.length),
    layoutVersion: session.layoutVersion,
  };
  progress.puzzles[levelKey(theme, face, session.level)] = { ...state, stats: { ...session.stats, activeMs: Math.round(session.stats.activeMs) } };
  save();
}
async function enterLevel(level) {
  if (busy || mode !== 'chapters' || face >= unlockedFaces(progress, theme) || level < 0 || level >= faceSize(theme)) return;
  const config = inJigsaw() ? jigsawConfig(theme, face, level) : levelConfig(theme, face, level);
  if (!config) return;
  remember('enterLevel');
  busy = true; mode = 'puzzle'; cube.setActive(false);
  const saved = progress.puzzles[levelKey(theme, face, level)];
  session = { level, art: levelArt(theme, face, level), stats: saved?.stats ? { ...saved.stats } : freshStats(), completed: false, unlock: null };
  const model = inJigsaw() ? createJigsaw(config, saved?.board) : null;
  if (model) {
    session.board = model.serialize();
  } else {
    session.positions = saved?.positions ?? initialLayout(theme, face, level);
    session.layoutVersion = saved?.layoutVersion ?? config.layoutVersion;
    $('#puzzle-board').replaceChildren();
    const layout = photoLayout(levelAspect(theme, face, level));
    for (const [key, value] of Object.entries(layout)) $('.puzzle-frame').style[key] = `${value}px`;
  }
  refresh();
  const ticket = loading.begin(120, session.art);
  const boardModule = model ? await import('./jigsaw-board.js') : null;
  const image = await loadImageAsset(session.art, (fraction) => ticket.progress(fraction * .9), { keepSource: !!model });
  if (!ticket.active) {
    if (model) URL.revokeObjectURL(image.src);
    return;
  }
  levelImage = image;
  if (model) {
    puzzle = new boardModule.JigsawBoard($('#jigsaw-workspace'), {
      model, imageUrl: image.src,
      onDrag: () => remember('dragPuzzle'),
      onWin: celebrateWin,
      onPreviewChange: refreshPuzzleToolbar,
      onChange: (snapshot, action) => {
        syncPlayTime(); session.stats.moves++; session.board = snapshot;
        if (action.hint) {
          useProp(progress, 'hint');
          session.stats.hints++;
        }
        audio.play(action.placed || action.joined ? 'merge' : 'move');
        if (model.solved) {
          recordCompletion({ columns: model.cols, rows: model.rows });
          puzzle.setBlocked(true);
        } else savePuzzle();
        refreshPuzzleToolbar();
      },
    });
    ticket.progress(1); ticket.finish();
  } else {
    puzzle = new PuzzleRenderer($('#puzzle-board'), session.positions, {
      onGrab: () => audio.unlock(), onDrag: () => remember('dragPuzzle'), onDrop: guarded(applyMove),
      onReady: () => { ticket.progress(1); ticket.finish(); },
    }, theme);
    await puzzle.init(image);
  }
  busy = false; refresh();
}

function recordCompletion(layout) {
  session.completed = true;
  session.unlock = markComplete(progress, theme, face, session.level);
  progress.records[levelKey(theme, face, session.level)] = { ...session.stats, activeMs: Math.round(session.stats.activeMs),
    ...layout, completedAt: Date.now() };
  save();
}
function celebrateWin() {
  audio.play('win'); puzzle.celebrate();
  winDelay = setTimeout(guarded(showWin), 2000);
}

async function applyMove(id, dx, dy, fromHint = false) {
  if (mode !== 'puzzle' || session.completed || (busy && !fromHint)) return;
  const next = moveGroup(session.positions, id, dx, dy);
  if (next.every((p, i) => p === session.positions[i])) { await puzzle.setPositions(session.positions); busy = false; puzzle.setBlocked(false); refresh(); return; }
  // Commit a hint only when it actually changes the board, together with its save.
  if (fromHint && !useProp(progress, 'hint')) { busy = false; puzzle.setBlocked(false); refresh(); return; }
  busy = true; puzzle.setBlocked(true);
  syncPlayTime(); session.stats.moves++; if (fromHint) session.stats.hints++;
  const connectedGroups = newlyConnectedGroups(session.positions, next);
  session.positions = next;
  if (solved(next)) recordCompletion({ gridSize: Math.sqrt(next.length), layoutVersion: session.layoutVersion });
  else savePuzzle();
  refresh(); await puzzle.setPositions(next);
  if (connectedGroups.length) { puzzle.flashGroups(connectedGroups); audio.play('merge'); }
  else audio.play('move');
  busy = false; puzzle.setBlocked(session.completed); refresh();
  if (session.completed) celebrateWin();
}

async function leavePuzzle() {
  if (mode !== 'puzzle' || busy) return;
  busy = true; clearTimeout(winDelay); clearTimeout(hintDelay); hintVersion++; hintWorker?.terminate(); hintWorker = null;
  savePuzzle(); closeOverlay(); const finished = session.completed, level = session.level, unlock = session.unlock;
  puzzle.destroy(); puzzle = null; session = null; releaseLevelImage(); mode = 'chapters'; refresh(); cube.setActive(true);
  if (finished) {
    await cube.reveal(face, level);
    if (unlock?.newFace) {
      await cube.showcase(unlock.newTheme ? 'theme' : 'chapter');
      if (unlock.newTheme && THEMES[theme + 1] && !THEMES[theme + 1].comingSoon) {
        await cube.leave(); mode = 'home'; theme++; face = 0; refresh();
        await cube.switchTheme(theme, 1); cube.celebrate(true);
      } else if (face + 1 < unlockedFaces(progress, theme)) { await cube.turn(face + 1); face++; }
    }
  }
  busy = false; refresh();
}

function releaseLevelImage() {
  if (inJigsaw() && levelImage) URL.revokeObjectURL(levelImage.src);
  levelImage = null;
}

function showOverlay(html, name, image) {
  setSettingsOpen(false, true);
  guide?.hide();
  if (cube) cube.gesture = null;
  overlayFocus = document.activeElement; $('#overlay-content').innerHTML = html; overlay.hidden = false;
  if (image) {
    const placeholder = $('#overlay-content img');
    image.alt = placeholder.alt; placeholder.replaceWith(image);
  }
  overlay.setAttribute('aria-label', name); $('#menu-screen').inert = true; $('#puzzle-screen').inert = true; $('.top-bar').inert = true;
  puzzle?.setBlocked(true); overlay.querySelector('button')?.focus({ preventScroll: true });
  syncPlayTime();
}
function closeOverlay() {
  winAnimations.forEach((animation) => animation.cancel()); winAnimations = [];
  overlay.removeAttribute('aria-busy');
  overlay.hidden = true; $('#menu-screen').inert = false; $('#puzzle-screen').inert = false; $('.top-bar').inert = false;
  $('#overlay-content').replaceChildren();
  if (puzzle) puzzle.setBlocked(busy || session?.completed); overlayFocus?.focus?.({ preventScroll: true });
  syncPlayTime();
}
async function showWin() {
  if (!session?.completed || mode !== 'puzzle') return;
  const finishedSession = session;
  busy = true; refresh();
  showOverlay(`<div class="overlay-card win-card"><div class="win-mark">${icon('check')}</div><img alt="已完成的拼图"/><div class="star-row">${icon('spark')}${icon('spark')}${icon('spark')}</div><button id="continue" class="icon-button next-level" aria-label="返回魔方并揭开图块" disabled>${icon('arrow')}</button></div>`, '拼图完成', levelImage);
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

function confirmModeReset() {
  if (!TEST_CONTROLS || !ready || busy || cube.busy || mode !== 'home' || !overlay.hidden) return;
  const selected = account.selected;
  const relockNotice = selected === 'A' && account.switchState === 'b-reset'
    ? '<br>Complete the third cube in A to unlock B again.' : '';
  showOverlay(`<div class="overlay-card reset-card"><div class="reset-mark" aria-hidden="true">${icon('reset')}</div><h2>Reset mode ${selected}?</h2><p>Progress and records in ${selected} will be cleared.<br>Its items, sound and guides will reset.${relockNotice}</p><div class="reset-actions"><button id="cancel-reset" class="icon-button reset-action" aria-label="Cancel reset">${icon('close')}</button><button id="confirm-reset" class="icon-button reset-action reset-confirm" aria-label="Confirm mode ${selected} reset">${icon('check')}</button></div></div>`, `Reset mode ${selected} confirmation`);
}
async function resetMode() {
  if (!TEST_CONTROLS || !ready || busy || mode !== 'home') return;
  busy = true;
  resetSelectedMode(account); progress = account[account.selected]; audio.enabled = progress.sound;
  // Replace the in-memory save too, so pagehide cannot write old progress back.
  save(); cube.resetProgress(progress, account.selected);
  const previousTheme = theme; theme = 0; face = 0;
  closeOverlay(); refresh();
  if (previousTheme !== 0) await cube.switchTheme(0, -1);
  busy = false; refresh(); $('#settings').focus({ preventScroll: true });
}

async function completeMode() {
  if (!TEST_CONTROLS || !ready || busy || cube.busy || mode !== 'home' || !overlay.hidden) return;
  setSettingsOpen(false);
  busy = true;
  completeAllLevels(progress);
  // Keep genuine play records and preferences; no synthetic completion metrics.
  save(); cube.resetProgress(progress, account.selected);
  const previousTheme = theme;
  theme = currentTheme(progress); face = currentFace(progress, theme); refresh();
  if (previousTheme !== theme) await cube.switchTheme(theme, 1);
  busy = false; refresh(); $('#settings').focus({ preventScroll: true });
}

$('#sound').addEventListener('click', () => {
  audio.enabled = !audio.enabled; audio.unlock();
  progress.sound = audio.enabled;
  save(); audio.play('move'); refresh();
});
if (TEST_CONTROLS) {
  $('#reset-account').addEventListener('click', confirmModeReset);
  $('#complete-all').addEventListener('click', guarded(completeMode));
}
$('#previous').addEventListener('click', guarded(() => navigate(-1)));
$('#next').addEventListener('click', guarded(() => navigate(1)));
bindButtonTap($('#back'), guarded(back));
bindButtonTap($('#settings'), () => setSettingsOpen(!settingsOpen, settingsOpen));
document.addEventListener('pointerdown', (e) => {
  if (!settingsOpen || e.target.closest('.puzzle-settings')) return;
  setSettingsOpen(false, true);
  // A dismissing touch must not also pick up the card underneath it.
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
document.addEventListener('focusin', (e) => {
  if (settingsOpen && !e.target.closest('.puzzle-settings')) setSettingsOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (settingsOpen && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setSettingsOpen(false, true); }
}, true);
$('#enter').addEventListener('click', guarded(enterCube));
$('#theme-pages').addEventListener('click', guarded((e) => { const b = e.target.closest('[data-theme]'); if (b) return selectTheme(Number(b.dataset.theme), Number(b.dataset.theme) > theme ? 1 : -1); }));
$('#chapter-pages').addEventListener('click', guarded((e) => { const b = e.target.closest('[data-face]'); if (b && !b.disabled) return selectFace(Number(b.dataset.face)); }));
$('#chapter-targets').addEventListener('click', guarded((e) => { const b = e.target.closest('[data-level]'); if (b) return enterLevel(Number(b.dataset.level)); }));
bindButtonTap($('#picture-peek'), () => {
  if (busy || !session || session.completed || settingsOpen || !overlay.hidden) return;
  if (inJigsaw() && puzzle.closePreview()) return;
  if (!useProp(progress, 'preview')) return;
  session.stats.previews++; savePuzzle();
  if (inJigsaw()) {
    puzzle.setPreview(true);
    $('#picture-peek').focus({ preventScroll: true });
    return;
  }
  refresh();
  showOverlay(`<div class="overlay-card"><button id="close-picture" class="icon-button overlay-close" aria-label="关闭原图">${icon('close')}</button><img alt="完整原图"/></div>`, '原图', levelImage);
});
function activateOverlayButton(button) {
  if (overlay.hidden || busy || !button) return;
  if (button.id === 'continue') return leavePuzzle();
  if (TEST_CONTROLS && button.id === 'confirm-reset') return resetMode();
  if (button.id === 'close-picture' || button.id === 'cancel-reset') closeOverlay();
}
bindButtonTap($('#overlay-content'), guarded(activateOverlayButton));
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!session?.completed) closeOverlay(); }
});
window.addEventListener('keydown', guarded((e) => {
  if (e.key === 'Escape' && !settingsOpen && overlay.hidden && puzzle?.closePreview?.()) { e.preventDefault(); return; }
  if (mode === 'puzzle' || settingsOpen || !overlay.hidden) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); return navigate(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); return navigate(1); }
  if (e.key === 'Escape') return back();
}));
bindButtonTap($('#hint'), () => {
  if (busy || !session || session.completed || settingsOpen || !overlay.hidden || progress.props.hint <= 0) return;
  if (inJigsaw()) return puzzle.placeHint();
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

export async function startGame(onFaceProgress) {
  refresh();
  cube = new CubeScene($('#cube-host'), progress, { onEnter: guarded(enterCube), onLevel: guarded(enterLevel), onRotate: () => remember('rotateCube') }, account.selected);
  await cube.init(onFaceProgress);
  guide = new IdleGuide($('#hand-guide'), guideContext, guideTarget);
  ready = true; busy = false; refresh();
  disposeNative = await bindNativeApp({
    onBack: async () => {
      // Swallow navigation while a move/transition is committing.
      if (!ready || busy || cube.busy) return true;
      if (modeSwitch.open) { modeSwitch.close(true); return true; }
      if (settingsOpen) { setSettingsOpen(false, true); return true; }
      if (puzzle?.closePreview?.()) return true;
      if (mode === 'home' && overlay.hidden) { save(); return false; }
      await back(); return true;
    },
    onActive: active => { nativeActive = active; syncAppActivity(); },
  });
  if (import.meta.env.DEV) window.__game = {
    state: () => structuredClone({ mode, gameplay: account.selected, theme, face, busy, ready, progress, session }),
    idle: () => ready && !busy && !cube.busy && (!puzzle || !puzzle.busy),
    cubePose: () => ({ quaternion: cube.current.quaternion.toArray(), scale: cube.current.scale.x, mode: cube.mode }),
    arrowColors: () => cube.arrows.map((arrow) => arrow.material.color.getHexString()),
    celebration: () => puzzle?.confetti?.particles.length ?? 0,
    tileCenter: (level, targetFace = face) => cube.tileScreen(targetFace, level),
    pieceCenter: (id) => {
      const r = $('#puzzle-board').getBoundingClientRect(), p = puzzle.screen(puzzle.world(session.positions[id]));
      return { x: r.left + p.x * r.width / puzzle.width, y: r.top + p.y * r.height / puzzle.height };
    },
    cellCenter: (cell) => {
      const r = $('#puzzle-board').getBoundingClientRect(), p = puzzle.screen(puzzle.world(cell));
      return { x: r.left + p.x * r.width / puzzle.width, y: r.top + p.y * r.height / puzzle.height };
    },
    revealed: () => cube.tiles[theme].filter((t) => t.userData.complete).map((t) => ({ face: t.userData.face, level: t.userData.level })),
    puzzleGeometry: () => puzzle?.cards && ({ aspect: puzzle.aspect, width: puzzle.width, height: puzzle.height, cards: puzzle.cards.map((c) => ({ position: c.mesh.position.toArray(), scale: c.mesh.scale.toArray(), rotation: c.mesh.rotation.toArray().slice(0, 3), vertices: [...c.picture.geometry.attributes.position.array], uv: [...c.picture.geometry.attributes.uv.array], flash: c.flash.material.opacity })) }),
    entrance: () => puzzle?.animation?.intro ? { elapsed: performance.now() - puzzle.animation.start, duration: puzzle.animation.duration, cards: structuredClone(puzzle.animation.introPlan) } : null,
  };
}
if (import.meta.hot) import.meta.hot.dispose(() => { disposeNative(); viewportObserver.disconnect(); document.removeEventListener('visibilitychange', syncAppActivity); window.removeEventListener('resize', queueResize); document.removeEventListener('visibilitychange', queueResize); cancelAnimationFrame(resizeFrame); clearTimeout(winDelay); clearTimeout(hintDelay); closeOverlay(); modeSwitch.destroy(); hintWorker?.terminate(); guide?.destroy(); puzzle?.destroy(); releaseLevelImage(); cube?.destroy(); audio.destroy(); });
