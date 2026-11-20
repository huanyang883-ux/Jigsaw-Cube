import { THEMES, faceSize, freshProgress, levelKey, restoreProgress, restoreProps, restoreStats, themeComplete } from './progress.js';
import { isJigsawSave, jigsawConfig, savedJigsawConfig } from './jigsaw.js';

const jigsawLevels = [];
for (const [theme, cube] of THEMES.entries()) {
  if (cube.comingSoon) continue;
  for (let face = 0; face < cube.chapters.length; face++) {
    for (let level = 0; level < faceSize(theme); level++) {
      const config = jigsawConfig(theme, face, level);
      jigsawLevels.push({ theme, index: face * faceSize(theme) + level, key: levelKey(theme, face, level), config });
    }
  }
}

export function jigsawUnlocked(account) {
  return account.switchState === 'unlocked' || account.switchState === 'b-reset' || themeComplete(account.A, 1);
}

// Keep the classic v2 payload readable by older builds. Both modes commit in the
// same save slot so a completion, mode selection or account reset is atomic.
export function restoreAccount(raw) {
  const classic = restoreProgress(raw);
  const jigsaw = freshProgress();
  const saved = raw?.jigsaw;
  const knownSave = saved?.version === 1;
  const account = { A: classic, B: jigsaw, selected: 'A', switchState: themeComplete(classic, 1) ? 'unlocked' : null };
  if (knownSave && ['unlocked', 'b-reset', 'locked'].includes(saved.switchState)) account.switchState = saved.switchState;
  if (knownSave && account.switchState) {
    if (saved.selected === 'B' && jigsawUnlocked(account)) account.selected = 'B';
    // Older B saves used the classic settings. Copy them once so future resets are independent.
    jigsaw.sound = (saved.sound ?? classic.sound) === true;
    const guides = saved.guides ?? classic.guides;
    for (const action of Object.keys(jigsaw.guides)) jigsaw.guides[action] = guides[action] === true;
    jigsaw.props = restoreProps(saved.props);
    for (const { theme, index, key, config } of jigsawLevels) {
      jigsaw.completed[theme][index] = saved.completed?.[key] === true;
      const puzzle = saved.puzzles?.[key];
      const cuts = puzzle?.board && savedJigsawConfig(config, puzzle.board.cols, puzzle.board.rows);
      if (cuts && isJigsawSave(cuts, puzzle.board)) {
        const placed = puzzle.board.groups.reduce((sum, group) => sum + (group.dx === 0 && group.dy === 0 ? group.ids.length : 0), 0);
        if (placed < cuts.cols * cuts.rows) {
          jigsaw.puzzles[key] = { board: puzzle.board, stats: restoreStats(puzzle.stats) };
        }
      }
      const record = saved.records?.[key];
      if (record && jigsaw.completed[theme][index]) {
        const recordedCuts = savedJigsawConfig(config, record.columns, record.rows) ?? config;
        jigsaw.records[key] = { ...restoreStats(record), columns: recordedCuts.cols, rows: recordedCuts.rows,
          completedAt: Number.isFinite(record.completedAt) ? record.completedAt : 0 };
      }
    }
  }
  return account;
}

export function serializeAccount(account) {
  let switchState = account.switchState;
  if (switchState !== 'b-reset' && jigsawUnlocked(account)) switchState = 'unlocked';
  if (!switchState) return account.A;
  const { completed, puzzles, records, props, sound, guides } = account.B;
  const completedLevels = {};
  for (const { theme, index, key } of jigsawLevels) if (completed[theme][index]) completedLevels[key] = true;
  return { ...account.A, jigsaw: { version: 1, selected: account.selected, switchState, completed: completedLevels, puzzles, records, props, sound, guides } };
}

export function resetSelectedMode(account) {
  if (account.selected === 'B') {
    account.switchState = 'b-reset';
  } else if (jigsawUnlocked(account)) {
    // Check the milestone before replacing A, even if the player never entered B.
    account.switchState = account.switchState === 'b-reset' ? 'locked' : 'unlocked';
  }
  account[account.selected] = freshProgress();
}

