import { valid, INITIAL_POSITIONS } from './puzzle.js';
import artManifest from './art-manifest.json' with { type: 'json' };
import { freshGuides, GUIDE_ACTIONS } from './guide-state.js';
import first12 from './first12-layouts.json' with { type: 'json' };
import laterLayouts from './later-layouts.json' with { type: 'json' };
import { THEME_ART } from './theme-art.js';

export const saveSlot = (search = '') => {
  const trial = new URLSearchParams(search).get('trial');
  return ['first12', 'all78'].includes(trial) ? `sweet-cube:trial:${trial}:v1` : 'sweet-cube:progress:v2';
};
export const SAVE_KEY = saveSlot(typeof location === 'undefined' ? '' : location.search);
export const WHITE_ART = '/assets/white.svg';
export const DESSERT_CHAPTERS = [
  { id: 'cake', name: '蛋糕' }, { id: 'candy', name: '糖果' }, { id: 'jelly', name: '果冻' },
  { id: 'icecream', name: '冰淇淋' }, { id: 'chocolate', name: '巧克力' }, { id: 'cream', name: '奶油' },
];
export const ANIMAL_CHAPTERS = [
  { id: 'ocean', name: '海洋生物' }, { id: 'amphibians', name: '两栖生物' }, { id: 'land', name: '陆地生物' },
  { id: 'insects', name: '昆虫' }, { id: 'birds', name: '鸟类' }, { id: 'ancient', name: '古生物' },
];
const artVersion = (id) => artManifest[id] ? `?v=${artManifest[id].hash.slice(0, 12)}` : '';
export const artUrl = (id) => `/assets/${id}.webp${artVersion(id)}`;
export const THEMES = [
  { order: 2, icon: THEME_ART[0].icon, color: '#eaa99c', chapters: DESSERT_CHAPTERS, faceArt: DESSERT_CHAPTERS.map((c) => artUrl(`${c.id}-face`)) },
  { order: 3, icon: THEME_ART[1].icon, color: '#a6c7ad', chapters: ANIMAL_CHAPTERS, faceArt: ANIMAL_CHAPTERS.map((c) => artUrl(`${c.id}-face`)) },
  { order: 4, icon: THEME_ART[2].icon, color: '#b59bcf', faceArt: Array(6).fill(WHITE_ART), comingSoon: true },
];
const levelArtId = (theme, face, level) => `${THEMES[theme].chapters[face].id}-${String(level + 1).padStart(2, '0')}`;
export const LEVEL_ART = Array.from({ length: 4 }, (_, i) => artUrl(`cake-0${i + 1}`));
export function levelAspect(theme, face, level) {
  const asset = artManifest[levelArtId(theme, face, level)];
  return asset ? asset.width / asset.height : 2 / 3;
}
export const INITIAL_PROPS = Object.freeze({ hint: 28, preview: 28 });
export const freshProgress = () => ({ version: 2, completed: [Array(24).fill(false), Array(54).fill(false)], puzzles: {}, sound: false, props: { ...INITIAL_PROPS }, guides: freshGuides(), records: {} });
export function completeAllLevels(progress) {
  for (const levels of progress.completed) levels.fill(true);
  // Replaying a completed test level should start from its current initial layout.
  progress.puzzles = {};
  return progress;
}
export const freshStats = () => ({ moves: 0, hints: 0, previews: 0, activeMs: 0 });
export function restoreStats(raw) {
  return Object.fromEntries(Object.keys(freshStats()).map((key) => [key, Number.isFinite(raw?.[key]) ? Math.max(0, Math.floor(raw[key])) : 0]));
}
export function useProp(progress, type) {
  if (!Object.hasOwn(INITIAL_PROPS, type) || !Number.isInteger(progress.props?.[type]) || progress.props[type] <= 0) return false;
  progress.props[type]--;
  return true;
}
export const faceSize = (theme) => THEMES[theme].order ** 2;
export const LEVEL_CONFIGS = [...first12, ...laterLayouts];
export const levelConfig = (theme, face = 0, level = 0) => theme < 2
  ? LEVEL_CONFIGS[(theme === 0 ? 0 : 24) + face * faceSize(theme) + level]
  : { gridSize: THEMES[theme].order + 1, layoutVersion: 1 };
export const puzzleSize = (theme, face = 0, level = 0) => levelConfig(theme, face, level).gridSize;
export const levelKey = (theme, face, level) => `${theme}:${face}:${level}`;
export const isComplete = (progress, theme, face, level) => !!progress.completed[theme]?.[face * faceSize(theme) + level];
export const faceComplete = (progress, theme, face) => Array.from({ length: faceSize(theme) }, (_, i) => isComplete(progress, theme, face, i)).every(Boolean);
export const themeComplete = (progress, theme) => !!progress.completed[theme]?.every(Boolean);
export const themeUnlocked = (progress, theme) => theme === 0 || (theme === 1 && themeComplete(progress, 0));
export function currentTheme(progress) {
  for (let theme = THEMES.length - 1; theme >= 0; theme--) {
    if (!THEMES[theme].comingSoon && themeUnlocked(progress, theme)) return theme;
  }
  return 0;
}
export function unlockedFaces(progress, theme) {
  if (!themeUnlocked(progress, theme)) return 0;
  let count = 1;
  while (count < 6 && faceComplete(progress, theme, count - 1)) count++;
  return count;
}
export function currentFace(progress, theme) {
  return Math.min(5, Math.max(0, unlockedFaces(progress, theme) - 1));
}
export function nextPlayableLevel(progress, theme, face) {
  if (!themeUnlocked(progress, theme) || face < 0 || face >= unlockedFaces(progress, theme)) return null;
  for (let level = 0; level < faceSize(theme); level++) if (!isComplete(progress, theme, face, level)) return level;
  return null;
}
export function markComplete(progress, theme, face, level) {
  if (!themeUnlocked(progress, theme) || !Number.isInteger(face) || face < 0 || face >= unlockedFaces(progress, theme) || !Number.isInteger(level) || level < 0 || level >= faceSize(theme)) return null;
  const wasFaceDone = faceComplete(progress, theme, face), wasThemeDone = themeComplete(progress, theme);
  progress.completed[theme][face * faceSize(theme) + level] = true;
  delete progress.puzzles[levelKey(theme, face, level)];
  return { newFace: !wasFaceDone && faceComplete(progress, theme, face), newTheme: !wasThemeDone && themeComplete(progress, theme) };
}
export function levelArt(theme, face, level) { return artUrl(levelArtId(theme, face, level)); }
export function initialLayout(theme, face, level) {
  const config = levelConfig(theme, face, level);
  return config.positions ? [...config.positions] : legacyInitialLayout(theme, face, level);
}
export function legacyInitialLayout(theme, face, level) {
  const size = THEMES[theme].order + 1;
  if (size === 3) {
    // Rotate both identities and destinations: four distinct, equally solvable starts.
    const rotate = (i) => (i % 3) * 3 + 2 - Math.floor(i / 3);
    let positions = [...INITIAL_POSITIONS];
    for (let turn = 0; turn < (face + level) % 4; turn++) {
      const next = Array(9); positions.forEach((cell, id) => { next[rotate(id)] = rotate(cell); }); positions = next;
    }
    return positions;
  }
  const p = Array.from({ length: size ** 2 }, (_, i) => i);
  // Preserve the original 4x4 layout solely for unfinished legacy saves.
  [[0, 5], [3, 10], [8, 15], [6, 12]].forEach(([a, b]) => { [p[a], p[b]] = [p[b], p[a]]; });
  return p;
}
// An old completed record or in-progress game keeps the grid used when it was played.
function savedGridSize(theme, config, version) {
  if (version === 1) return THEMES[theme].order + 1;
  if (version === config.layoutVersion || version === 3 && config.layoutVersion === 4) return config.gridSize;
  return config.previousLayouts?.find(layout => layout.layoutVersion === version)?.gridSize ?? 0;
}
export function restoreProgress(raw) {
  const result = freshProgress();
  if (!raw || raw.version !== 2) return result;
  for (let theme = 0; theme < 2; theme++) {
    if (theme === 1 && !themeComplete(result, 0)) break;
    for (let face = 0; face < 6; face++) {
      if (face && !faceComplete(result, theme, face - 1)) break;
      for (let level = 0; level < faceSize(theme); level++) result.completed[theme][face * faceSize(theme) + level] = raw.completed?.[theme]?.[face * faceSize(theme) + level] === true;
    }
  }
  result.sound = raw.sound === true;
  for (const [type, initial] of Object.entries(INITIAL_PROPS)) {
    const count = raw.props?.[type];
    // Older v2 saves have no inventory. Preserve zero; never refill on reload.
    result.props[type] = count === undefined ? initial : Number.isFinite(count) ? Math.max(0, Math.min(initial, Math.floor(count))) : 0;
  }
  for (const [key, value] of Object.entries(raw.puzzles ?? {})) {
    if (!/^([01]):([0-5]):([0-8])$/.test(key)) continue;
    const [theme, face, level] = key.split(':').map(Number);
    if (face >= unlockedFaces(result, theme) || level >= faceSize(theme) || isComplete(result, theme, face, level)) continue;
    if (!value || typeof value !== 'object') continue;
    const config = levelConfig(theme, face, level), layoutVersion = value.layoutVersion ?? 1;
    const gridSize = savedGridSize(theme, config, layoutVersion);
    if (valid(value.positions) && value.positions.length === gridSize ** 2) {
      result.puzzles[key] = { positions: [...value.positions], gridSize, layoutVersion, stats: restoreStats(value.stats) };
    }
  }
  for (const [key, value] of Object.entries(raw.records ?? {})) {
    if (!/^([01]):([0-5]):([0-8])$/.test(key) || !value || typeof value !== 'object') continue;
    const [theme, face, level] = key.split(':').map(Number);
    if (level >= faceSize(theme) || !isComplete(result, theme, face, level)) continue;
    const config = levelConfig(theme, face, level), version = value.layoutVersion ?? 1;
    const gridSize = savedGridSize(theme, config, version);
    if (gridSize) result.records[key] = { ...restoreStats(value), gridSize, layoutVersion: version, completedAt: Number.isFinite(value.completedAt) ? value.completedAt : 0 };
  }
  for (const action of GUIDE_ACTIONS) result.guides[action] = raw.guides?.[action] === true;
  // Older saves can prove entry / play experience, but never prove manual orbit.
  const hasCompletion = result.completed.some((theme) => theme.some(Boolean));
  const savedPuzzles = Object.entries(result.puzzles);
  if (hasCompletion || savedPuzzles.length) { result.guides.enterChapter = true; result.guides.enterLevel = true; }
  if (!raw.guides && (hasCompletion || savedPuzzles.some(([key, value]) => {
    const initial = (value.layoutVersion === 1 ? legacyInitialLayout : initialLayout)(...key.split(':').map(Number));
    return value.positions.some((cell, id) => cell !== initial[id]);
  }))) result.guides.dragPuzzle = true;
  return result;
}
