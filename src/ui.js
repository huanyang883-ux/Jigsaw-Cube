import { icon } from './icons.js';
export function mountUI() {
  document.querySelector('#app').innerHTML = `
    <div class="viewport" data-theme="0"><div class="scene-background" aria-hidden="true">${[0, 1, 2].map(theme => `<div class="scene-layer" data-scene="${theme}"><div class="scene-art">
      <div class="ambient ambient-mint" aria-hidden="true"></div><div class="ambient ambient-peach" aria-hidden="true"></div>
      <div class="cloud cloud-one" aria-hidden="true"></div><div class="cloud cloud-two" aria-hidden="true"></div><div class="floor-pattern" aria-hidden="true"></div>
      <div class="background-doodle doodle-one" aria-hidden="true">${icon('spark')}</div><div class="background-doodle doodle-two" aria-hidden="true">${icon('flower')}</div>
    </div></div>`).join('')}</div><div class="stage-shell"><main class="game-stage" id="game" data-mode="home" aria-label="魔方拼图">
      <header class="top-bar">
        <div class="home-actions"><button id="sound" class="icon-button" aria-label="Sound on">${icon('mute')}</button><button id="reset-account" class="icon-button" aria-label="Reset account" disabled>${icon('reset')}</button></div>
        <div class="puzzle-tools" hidden>
          <button id="hint" class="icon-button tool accent" aria-label="Hint">${icon('bulb')}<span class="prop-count" id="hint-count" aria-hidden="true"></span></button>
          <button id="picture-peek" class="icon-button tool preview-tool" aria-label="Preview">${icon('eye')}<span class="prop-count" id="preview-count" aria-hidden="true"></span></button>
        </div>
        <div class="puzzle-progress" role="progressbar" aria-label="Puzzle progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div id="puzzle-fill"></div></div>
        <div class="top-emblem" aria-hidden="true">${icon('candy')}</div><button id="back" class="icon-button" aria-label="Back" hidden>${icon('back')}</button>
        <div class="puzzle-settings" hidden><button id="settings" class="icon-button" aria-label="Settings" aria-expanded="false" aria-controls="settings-menu">${icon('gear')}</button><div id="settings-menu" class="settings-menu" role="group" aria-label="Settings" aria-hidden="true" inert></div></div>
      </header>
      <section id="menu-screen" class="screen" aria-label="魔方与章节选择">
        <div class="theme-medallion" id="theme-medallion" aria-hidden="true">${icon('candy')}</div><div class="medallion-stars" aria-hidden="true">${icon('spark')}${icon('spark')}</div>
        <div class="cube-shadow" aria-hidden="true"></div><div id="cube-host" aria-label="拖动旋转魔方，点击进入章节"></div>
        <button id="previous" class="arrow-hotspot arrow-left" aria-label="上一页"></button><button id="next" class="arrow-hotspot arrow-right" aria-label="下一页"></button>
        <div id="chapter-targets" aria-label="本章关卡" hidden></div>
        <div id="face-progress" class="face-progress" aria-label="章节进度"></div><button id="enter" class="play-button" aria-label="进入魔方">${icon('play')}</button>
        <div id="theme-pages" class="theme-pages" aria-label="选择主题"></div><div id="chapter-pages" class="chapter-pages" aria-label="选择已解锁章节" hidden></div>
      </section>
      <section id="puzzle-screen" class="screen" aria-label="拼图关卡" hidden>
        <div class="puzzle-frame"><div id="puzzle-board" tabindex="0" role="application" aria-label="拖动拼片交换位置。方向键选择，空格拿起，回车放下。"></div></div>
      </section>
      <div id="hand-guide" class="hand-guide" aria-hidden="true" hidden><img alt="" draggable="false"/></div>
      <div class="bottom-grip" aria-hidden="true"></div>
    </main></div>
      <div id="overlay" class="overlay" role="dialog" aria-modal="true" hidden><div id="overlay-content"></div></div>
    </div>`;
}
