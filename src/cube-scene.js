import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { stageResolution } from './render-resolution.js';
import { THEMES, isComplete, faceSize, themeUnlocked, currentTheme, currentFace } from './progress.js';
import { createBackTexture } from './card-back.js';
import { THEME_ART, JIGSAW_THEME_ART } from './theme-art.js';
import { loadImageAsset } from './preload.js';

const FACE_ROTATIONS = [[0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0], [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0]];
const FACE_NORMALS = FACE_ROTATIONS.map((rotation) => new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...rotation)));
export const faceQuaternion = (face) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_ROTATIONS[face])).invert();
export const homeQuaternion = (face) => new THREE.Quaternion().setFromEuler(new THREE.Euler(.34, -.55, -.10)).multiply(faceQuaternion(face));
const smooth = (t) => t * t * (3 - 2 * t);
const themeSlideMs = 460;
// At chapter scale the cube's bounding sphere spans at most 750 * sqrt(3)
// stage units. Center the WebGL surface on the cube and leave room for its bob.
const viewTop = 704, viewHeight = 1344;
const isFront = ({ depth }) => depth > .04;
const svgNS = 'http://www.w3.org/2000/svg';
const starPath = 'M0 -1 L.22 -.22 1 0 .22 .22 0 1 -.22 .22 -1 0 -.22 -.22 Z';

function orderedFaces(pose) {
  const direction = new THREE.Vector3();
  return FACE_NORMALS.map((normal, face) => ({
    face, depth: direction.copy(normal).applyQuaternion(pose).z,
  })).sort((left, right) => right.depth - left.depth);
}

function orderedFaceArt(theme, pose) {
  if (THEMES[theme].comingSoon) return [];
  return orderedFaces(pose).map((entry) => ({ ...entry, theme, url: THEMES[theme].faceArt[entry.face] }));
}

function tileMap(texture, order, level, x = 0, y = 0, width = 1, height = 1) {
  const map = texture.clone();
  map.repeat.set(width / order, height / order);
  map.offset.set(x + level % order * map.repeat.x, y + (order - 1 - Math.floor(level / order)) * map.repeat.y);
  return map;
}

function stickerGeometry(size) {
  const h = size / 2, r = size * .075, shape = new THREE.Shape();
  shape.moveTo(-h + r, -h); shape.lineTo(h - r, -h); shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r); shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h); shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r); shape.quadraticCurveTo(-h, -h, -h + r, -h);
  const geo = new THREE.ShapeGeometry(shape, 4), uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / size + .5, uv.getY(i) / size + .5);
  return geo;
}

// Home stickers are fixed relative to their face. The back repeats once per
// tile; a fully revealed face samples the cover continuously across the gaps.
function stickerFaceGeometries(sticker, order) {
  const tiles = Array.from({ length: order ** 2 }, (_, level) =>
    sticker.clone().translate((level % order + .5) / order - .5, .5 - (Math.floor(level / order) + .5) / order, 0));
  const back = mergeGeometries(tiles);
  tiles.forEach((tile, level) => {
    const uv = tile.getAttribute('uv');
    const col = level % order, row = order - 1 - Math.floor(level / order);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + col) / order, (uv.getY(i) + row) / order);
  });
  return { back, cover: mergeGeometries(tiles) };
}

function arrowGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-19, 54); shape.lineTo(28, 8); shape.quadraticCurveTo(36, 0, 28, -8);
  shape.lineTo(-19, -54); shape.quadraticCurveTo(-28, -62, -37, -52);
  shape.lineTo(-42, -46); shape.quadraticCurveTo(-47, -39, -39, -31);
  shape.lineTo(-8, 0); shape.lineTo(-39, 31); shape.quadraticCurveTo(-47, 39, -42, 46);
  shape.lineTo(-37, 52); shape.quadraticCurveTo(-28, 62, -19, 54);
  return new THREE.ExtrudeGeometry(shape, { depth: 20, bevelEnabled: true, bevelThickness: 5, bevelSize: 4, bevelSegments: 4, steps: 1 });
}

export class CubeScene {
  constructor(host, progress, callbacks, gameplay = 'A') {
    this.host = host; this.progress = progress; this.callbacks = callbacks;
    this.palette = gameplay === 'B' ? JIGSAW_THEME_ART : THEME_ART;
    this.mode = 'home'; this.theme = currentTheme(progress); this.face = currentFace(progress, this.theme); this.active = true;
    this.busy = true; this.particles = []; this.models = []; this.tiles = [];
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.abort = new AbortController(); this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(); this.spin = new THREE.Vector3(.06, .1, .025); this.targetSpin = this.spin.clone();
    this.faceNormal = new THREE.Vector3();
    this.failedFaceArt = new Set(); this.nextArtCheck = 0;
  }

  async init(onFaceProgress = () => {}) {
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.camera = new THREE.OrthographicCamera(-540, 540, viewTop, viewTop - viewHeight, 1, 6000);
    this.camera.position.set(0, 0, 2500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.renderer.domElement.className = 'cube-canvas'; this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.style.top = `${960 - viewTop}px`;
    this.renderer.domElement.style.height = `${viewHeight}px`;
    this.host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xfffcf4, 0xc3bcad, 1.15));
    const key = new THREE.DirectionalLight(0xfff8ed, 1.8); key.position.set(-900, 1400, 1800); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd5e9ed, .65); fill.position.set(1000, -300, 800); this.scene.add(fill);
    this.themeBacks = this.palette.map((art, theme) => createBackTexture(1, theme, art));
    this.art = new Map();
    for (let i = 0; i < THEMES.length; i++) this.models.push(this.buildCube(i));
    this.models.forEach((cube, i) => { cube.visible = i === this.theme; this.scene.add(cube); });
    this.current = this.models[this.theme]; this.current.scale.setScalar(460); this.current.position.set(0, 35, 0);
    this.current.quaternion.copy(homeQuaternion(this.face));
    this.planFaceArt();
    this.makeArrows();
    // Prepare every theme during loading, before a switch can reveal it.
    for (const texture of this.themeBacks) this.renderer.initTexture(texture);
    let frontProgress = 0, previewProgress = 0;
    const report = () => onFaceProgress((frontProgress * 3 + previewProgress) / 4);
    const [fronts, previews] = await Promise.all([
      this.preloadFrontArt((value) => { frontProgress = value; report(); }),
      loadImageAsset(new URL('./cube-previews.webp', import.meta.url).href, (value) => { previewProgress = value; report(); }),
      this.renderer.compileAsync(this.scene, this.camera),
    ]);
    this.resizeRenderers();
    this.installPreviews(previews);
    for (const art of fronts) if (art) this.installFaceArt(art);
    this.drawDecor(); this.events(); this.busy = false; this.nextSpin = 0;
    this.renderCube();
    this.scheduleFrame();
  }

  resizeRenderers() {
    if (!this.active || !this.renderer || this.contextLost || document.hidden) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    const resolution = stageResolution(Math.min(width / 1080, height / 1920, 1));
    if (resolution === this.resolution) return;
    this.resolution = resolution;
    this.renderer.setDrawingBufferSize(1080, viewHeight, resolution);
  }

  scheduleFrame() {
    if (this.frame == null && this.active && !document.hidden && !this.contextLost) this.frame = requestAnimationFrame(this.tick);
  }

  setActive(active) {
    this.active = active;
    if (active && !document.hidden && !this.contextLost) {
      this.resizeRenderers();
      this.scheduleFrame();
    } else {
      this.cancelGesture();
      this.cancelFaceArt();
      cancelAnimationFrame(this.frame); this.frame = null; this.lastFrame = null;
    }
  }

  cancelGesture() {
    const pointerId = this.gesture?.pointerId;
    this.gesture = null;
    if (pointerId != null && this.host.hasPointerCapture(pointerId)) this.host.releasePointerCapture(pointerId);
  }

  cancelFaceArt() {
    this.faceArtJob?.abort.abort(); this.faceArtJob = null;
  }

  async preloadFrontArt(onProgress) {
    const fronts = orderedFaceArt(this.theme, this.current.quaternion).filter(isFront);
    if (!fronts.length) { onProgress(1); return []; }
    const fractions = fronts.map(() => 0);
    const report = (index, fraction) => {
      fractions[index] = fraction;
      onProgress(fractions.reduce((sum, part) => sum + part, 0) / fronts.length);
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      return await Promise.all(fronts.map(async (entry, index) => {
        try {
          return { ...entry, image: await loadImageAsset(entry.url, (fraction) => report(index, fraction), { signal: abort.signal }) };
        } catch {
          this.failedFaceArt.add(entry.url);
          report(index, 1);
          return null;
        }
      }));
    } finally { clearTimeout(timer); }
  }

  planFaceArt(keepFrontsOnly = false) {
    const theme = this.theme, total = THEMES.length;
    const front = this.mode === 'chapters' ? this.face : currentFace(this.progress, theme);
    const current = orderedFaceArt(theme, this.mode === 'chapters' ? faceQuaternion(front) : homeQuaternion(front));
    const neighbors = [(theme + total - 1) % total, (theme + 1) % total]
      .flatMap((index) => orderedFaceArt(index, homeQuaternion(currentFace(this.progress, index))).filter(isFront));
    const fronts = [...current.filter(isFront), ...neighbors];
    if (keepFrontsOnly) {
      const keep = new Set(fronts.map(({ url }) => url));
      for (const url of this.art.keys()) if (!keep.has(url)) this.releaseFaceArt(url);
    }
    this.faceArtQueue = [...fronts, ...current.filter((entry) => !isFront(entry))];
    if (this.faceArtJob && this.faceArtJob.url !== this.nextFaceArt()?.url) this.cancelFaceArt();
    this.nextArtCheck = 0;
  }

  nextFaceArt() {
    while (this.faceArtQueue.length) {
      const entry = this.faceArtQueue[0];
      if (!this.art.has(entry.url) && !this.failedFaceArt.has(entry.url)) return entry;
      this.faceArtQueue.shift();
    }
  }

  requestFaceArt(theme, face) {
    const url = THEMES[theme].faceArt[face];
    if (this.art.has(url) || this.failedFaceArt.has(url) || !this.active || document.hidden || this.contextLost) return;
    if (this.faceArtJob?.url === url) return;
    this.cancelFaceArt();
    const job = this.faceArtJob = { theme, face, url, abort: new AbortController() };
    loadImageAsset(url, undefined, { signal: job.abort.signal, background: true }).then((image) => {
      if (this.faceArtJob === job) job.image = image;
    }).catch(() => {
      if (this.faceArtJob !== job) return;
      this.faceArtJob = null; this.failedFaceArt.add(url);
    });
  }

  applyFaceArt(theme, face) {
    const job = this.faceArtJob;
    if (!job?.image || job.theme !== theme || job.face !== face) return;
    this.faceArtJob = null;
    this.installFaceArt(job);
  }

  installPreviews(image) {
    const atlas = this.previewAtlas = new THREE.Texture(image);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.generateMipmaps = false;
    atlas.minFilter = THREE.LinearFilter;
    atlas.needsUpdate = true;
    const size = image.width / 6;
    for (const [theme, cube] of this.models.entries()) {
      if (THEMES[theme].comingSoon) continue;
      for (const surface of cube.children) {
        const { tiles } = surface.userData;
        if (!tiles) continue;
        const face = tiles.children[0].userData.face;
        // Sample between texel centers so filtering cannot bleed into an adjacent cover.
        const x = (face * size + .5) / image.width;
        const y = 1 - ((theme + 1) * size - .5) / image.height;
        const width = (size - 1) / image.width, height = (size - 1) / image.height;
        surface.userData.preview = tileMap(atlas, 1, 0, x, y, width, height);
        for (const tile of tiles.children) {
          const { level, complete } = tile.userData;
          const preview = tileMap(atlas, THEMES[theme].order, level, x, y, width, height);
          tile.userData.preview = preview;
          if (complete) tile.material.map = preview;
        }
      }
    }
    this.renderer.initTexture(atlas);
  }

  installFaceArt({ theme, face, url, image }) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.art.set(url, { theme, face, texture });
    const n = THEMES[theme].order;
    const count = n ** 2;
    for (const tile of this.tiles[theme].slice(face * count, (face + 1) * count)) {
      const map = tileMap(texture, n, tile.userData.level);
      tile.userData.picture = map;
      if (tile.userData.complete) tile.material.map = map;
    }
    this.renderer.initTexture(texture);
  }

  releaseFaceArt(url) {
    const { theme, face, texture } = this.art.get(url);
    const count = faceSize(theme);
    for (const tile of this.tiles[theme].slice(face * count, (face + 1) * count)) {
      tile.material.map = tile.userData.complete ? tile.userData.preview : this.themeBacks[theme];
      tile.userData.picture?.dispose();
      tile.userData.picture = null;
    }
    texture.dispose(); texture.image = null;
    this.art.delete(url);
  }

  updateFaceArt(time) {
    if (this.busy || this.gesture || time < this.nextArtCheck || (!this.faceArtJob && !this.faceArtQueue.length)) return;
    this.nextArtCheck = time + 120;
    const job = this.faceArtJob;
    if (job) this.applyFaceArt(job.theme, job.face);
    const next = this.nextFaceArt();
    if (!this.faceArtJob && next) this.requestFaceArt(next.theme, next.face);
  }

  resetProgress(progress, gameplay = 'A', homeTheme) {
    this.cancelFaceArt(); this.failedFaceArt.clear(); this.cancelGesture();
    if (homeTheme !== undefined) {
      this.current.visible = false;
      this.current = this.models[homeTheme]; this.current.visible = true;
      this.current.position.set(0, 35, 0); this.current.scale.setScalar(460);
      this.theme = this.arrowTheme = homeTheme;
      this.mode = 'home'; this.homePose = null;
    }
    this.progress = progress; this.face = currentFace(progress, this.theme);
    const palette = gameplay === 'B' ? JIGSAW_THEME_ART : THEME_ART;
    if (palette !== this.palette) {
      this.palette = palette;
      for (const texture of this.themeBacks) texture.dispose();
      this.themeBacks = palette.map((art, theme) => {
        this.models[theme].userData.shellMaterial.color.set(art.body);
        return createBackTexture(1, theme, art);
      });
    }
    for (const tile of this.tiles.flat()) {
      const { theme, face, level } = tile.userData;
      tile.userData.complete = isComplete(progress, theme, face, level);
      tile.material.map = tile.userData.complete ? tile.userData.picture ?? tile.userData.preview : this.themeBacks[theme];
      tile.material.needsUpdate = true;
    }
    if (this.mode === 'home') this.current.quaternion.copy(homeQuaternion(this.face));
    this.planFaceArt(true);
  }

  buildCube(theme) {
    const cube = new THREE.Group(), n = THEMES[theme].order, unit = 1 / n;
    // High-order bevels span only a few pixels. Share their untextured
    // vertices so each shell instance can reuse the transformed corners.
    const rounded = new RoundedBoxGeometry(unit * .972, unit * .972, unit * .972, n >= 4 ? 1 : 2, unit * .075);
    rounded.deleteAttribute('uv');
    const bodyGeo = mergeVertices(rounded);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: this.palette[theme].body, roughness: .65, metalness: 0 });
    cube.userData.shellMaterial = bodyMaterial;
    // All shell blocks share one geometry/material and one draw submission.
    const body = new THREE.InstancedMesh(bodyGeo, bodyMaterial, n ** 3 - Math.max(0, n - 2) ** 3);
    const matrix = new THREE.Matrix4(); let instance = 0;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
      if (x && x < n - 1 && y && y < n - 1 && z && z < n - 1) continue;
      body.setMatrixAt(instance++, matrix.makeTranslation((x + .5) / n - .5, (y + .5) / n - .5, (z + .5) / n - .5));
    }
    body.instanceMatrix.needsUpdate = true; cube.add(body);
    const stickerGeo = stickerGeometry(unit * .899);
    const faceGeometry = cube.userData.faceGeometry = stickerFaceGeometries(stickerGeo, n);
    const tileList = [];
    for (let face = 0; face < 6; face++) {
      const surface = new THREE.Group(); surface.rotation.set(...FACE_ROTATIONS[face]);
      const tiles = new THREE.Group();
      const batch = new THREE.Mesh(faceGeometry.back, new THREE.MeshBasicMaterial({ map: this.themeBacks[theme], toneMapped: false }));
      surface.add(tiles, batch); batch.visible = false;
      Object.assign(surface.userData, { tiles, batch, coverUrl: THEMES[theme].faceArt[face] });
      surface.userData.normal = FACE_NORMALS[face];
      surface.position.copy(new THREE.Vector3(0, 0, .5005).applyEuler(surface.rotation));
      cube.add(surface);
      for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
        const index = row * n + col;
        const complete = !THEMES[theme].comingSoon && isComplete(this.progress, theme, face, index);
        // Printed artwork keeps the same sRGB colors as the puzzle cards.
        // Lighting and exposure belong to the shell, not to the photograph.
        const mat = new THREE.MeshBasicMaterial({ map: this.themeBacks[theme], toneMapped: false });
        const tile = new THREE.Mesh(stickerGeo, mat);
        tile.position.set((col + .5) / n - .5, .5 - (row + .5) / n, 0);
        tile.userData = { theme, face, level: index, picture: null, complete };
        tiles.add(tile); tileList.push(tile);
      }
    }
    this.tiles[theme] = tileList;
    return cube;
  }

  arrowTint() {
    const art = this.palette[this.arrowTheme];
    if (this.mode === 'home' && !themeUnlocked(this.progress, this.arrowTheme)) return art.border;
    return this.palette === JIGSAW_THEME_ART ? art.panel : art.fill;
  }

  makeArrows() {
    this.arrowTheme = this.theme; this.arrowPalette = this.arrowTint();
    this.arrowColor = new THREE.Color(this.arrowPalette);
    this.arrowFrom = this.arrowColor.clone(); this.arrowTarget = this.arrowColor.clone(); this.arrowColorStarted = 0;
    const geo = arrowGeometry(), material = new THREE.MeshStandardMaterial({ color: this.arrowColor, roughness: .43, metalness: .04 });
    this.arrows = [-1, 1].map((dir) => {
      const arrow = new THREE.Mesh(geo, material.clone()); arrow.position.set(dir * 447, 35, 90);
      arrow.rotation.y = dir * -.22; arrow.rotation.z = dir === -1 ? Math.PI : 0;
      this.scene.add(arrow); return arrow;
    });
  }

  drawDecor() {
    this.effects = document.createElementNS(svgNS, 'svg');
    this.effects.setAttribute('class', 'cube-effects');
    this.effects.setAttribute('viewBox', '0 0 1080 1920');
    this.effects.setAttribute('aria-hidden', 'true');
    this.effects.innerHTML = `
      <g fill="none" stroke="#cab89b">
        ${[[172, 533, 15], [908, 570, 12], [923, 1277, 18], [177, 1250, 10]].map(([x, y, r]) =>
          `<path d="${starPath}" transform="translate(${x} ${y}) scale(${r})" stroke-width="${2.7 / r}"/>`).join('')}
      </g>
      <path d="M157 692 C114 708 124 747 157 735 C190 719 137 691 125 725" fill="none" stroke="#c9d3b4" stroke-width="3.5" stroke-linecap="round"/>
      <g fill="#d6c7ac" opacity=".6"><circle cx="861" cy="462" r="6"/><circle cx="214" cy="1420" r="6"/><circle cx="854" cy="1350" r="6"/></g>`;
    this.host.appendChild(this.effects);
  }

  events() {
    const signal = this.abort.signal;
    this.host.addEventListener('pointerdown', (e) => {
      if (!this.active || this.busy || e.button !== 0 || this.gesture) return;
      this.gesture = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, pointerId: e.pointerId };
      this.host.setPointerCapture(e.pointerId);
    }, { signal });
    this.host.addEventListener('pointermove', (e) => {
      const drag = this.gesture;
      if (!drag || e.pointerId !== drag.pointerId || this.busy || !this.active) return;
      const scale = this.host.getBoundingClientRect().width / 1080;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) / scale > 12) drag.moved = true;
      if (!drag.moved || this.mode !== 'home') return;
      const dx = (e.clientX - drag.lastX) / scale, dy = (e.clientY - drag.lastY) / scale;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * .0035, dx * .0035, 0));
      this.current.quaternion.premultiply(rotation).normalize();
      if (!drag.reported) { drag.reported = true; this.callbacks.onRotate?.(); }
      drag.lastX = e.clientX; drag.lastY = e.clientY;
    }, { signal });
    this.host.addEventListener('pointerup', (e) => {
      if (!this.gesture || e.pointerId !== this.gesture.pointerId) return;
      const start = this.gesture; this.gesture = null;
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
      if (this.busy || !this.active) return;
      if (start.moved) return;
      const tile = this.pick(e.clientX, e.clientY);
      if (this.mode === 'home' && tile) this.callbacks.onEnter();
      else if (tile && tile.userData.face === this.face) this.callbacks.onLevel(tile.userData.level);
    }, { signal });
    const cancel = () => this.cancelGesture();
    this.host.addEventListener('pointercancel', cancel, { signal });
    this.host.addEventListener('lostpointercapture', cancel, { signal });
    window.addEventListener('blur', cancel, { signal });
    document.addEventListener('visibilitychange', () => this.setActive(this.active), { signal });
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); this.contextLost = true; this.setActive(this.active);
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false; this.setActive(this.active);
    }, { signal });
  }

  pick(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Hit testing uses the individual stickers even when a whole face is batched.
    this.current.updateWorldMatrix(true, true);
    return this.raycaster.intersectObjects(this.tiles[this.theme], false).find((hit) => hit.object.visible)?.object;
  }

  frontFace() { return orderedFaces(this.current.quaternion)[0].face; }

  tween(duration, update) {
    return new Promise((resolve) => {
      this.motion?.resolve();
      this.motion = { start: performance.now(), duration: this.reducedMotion ? 1 : duration, update, resolve };
      this.busy = true;
    });
  }

  async switchTheme(theme, direction) {
    this.arrowTheme = theme;
    this.failedFaceArt.clear();
    this.face = currentFace(this.progress, theme);
    const old = this.current, next = this.models[theme], startQuaternion = homeQuaternion(this.face);
    // 950 clears the 1080-wide camera even at the widest cube orientation.
    // Anything further adds empty travel between the two visible models.
    const travel = direction * 950;
    this.theme = theme; next.visible = true; next.scale.setScalar(460); next.position.set(travel, 35, 0); next.quaternion.copy(startQuaternion);
    this.planFaceArt();
    const first = this.nextFaceArt();
    if (first?.theme === theme && isFront(first)) this.requestFaceArt(theme, first.face);
    await this.tween(themeSlideMs, (t) => {
      const e = smooth(t); old.position.x = -travel * e; next.position.x = travel * (1 - e);
      const scale = 460 - 30 * Math.sin(t * Math.PI);
      old.scale.setScalar(scale); next.scale.setScalar(scale);
      if (!this.reducedMotion) next.position.y = 35 + Math.sin(performance.now() * .00065) * 11;
    });
    old.visible = false; next.position.x = 0; next.scale.setScalar(460); this.current = next;
    this.planFaceArt(true);
  }

  async enter(face) {
    this.failedFaceArt.delete(THEMES[this.theme].faceArt[face]);
    this.homePose = { quaternion: this.current.quaternion.clone(), position: this.current.position.clone(), scale: this.current.scale.x };
    this.face = face; this.mode = 'chapters';
    const from = this.current.quaternion.clone(), to = faceQuaternion(face), startScale = this.current.scale.x, startY = this.current.position.y;
    await this.tween(1050, (t) => {
      const e = smooth(t); this.current.quaternion.slerpQuaternions(from, to, e);
      this.current.scale.setScalar(startScale + (750 - startScale) * e);
      this.current.position.y = startY * (1 - e) + 35 * e;
    });
    this.planFaceArt();
  }

  async leave() {
    const from = this.current.quaternion.clone(), startScale = this.current.scale.x, startY = this.current.position.y, pose = this.homePose;
    await this.tween(900, (t) => {
      const e = smooth(t); this.current.quaternion.slerpQuaternions(from, pose.quaternion, e);
      this.current.scale.setScalar(startScale + (pose.scale - startScale) * e);
      this.current.position.y = startY + (pose.position.y - startY) * e;
    });
    this.mode = 'home';
    this.planFaceArt();
  }

  async turn(face) {
    this.failedFaceArt.delete(THEMES[this.theme].faceArt[face]);
    const from = this.current.quaternion.clone(), to = faceQuaternion(face);
    await this.tween(760, (t) => {
      this.current.quaternion.slerpQuaternions(from, to, smooth(t));
      this.current.scale.setScalar(750 - Math.sin(t * Math.PI) * 145);
    });
    this.face = face; this.current.scale.setScalar(750);
    this.planFaceArt();
  }

  async reveal(face, level) {
    const tile = this.tiles[this.theme].find((t) => t.userData.face === face && t.userData.level === level);
    if (!tile || tile.userData.complete) return;
    this.failedFaceArt.delete(THEMES[this.theme].faceArt[face]);
    this.requestFaceArt(this.theme, face);
    let swapped = false;
    await this.tween(680, (t) => {
      tile.scale.x = Math.max(.025, Math.abs(Math.cos(t * Math.PI)));
      tile.position.z = Math.sin(t * Math.PI) * .03;
      if (t >= .5 && !swapped) {
        swapped = true; this.applyFaceArt(this.theme, face);
        tile.userData.complete = true;
        tile.material.map = tile.userData.picture ?? tile.userData.preview;
      }
    });
    tile.scale.x = 1; tile.position.z = 0;
    this.celebrate(false);
  }

  async showcase(kind) {
    // Extension hook: replace this sequence with a custom chapter/theme animation.
    this.host.dispatchEvent(new CustomEvent('cube-showcase-start', { detail: { kind, theme: this.theme, face: this.face } }));
    this.celebrate(true);
    const pose = this.current.quaternion.clone(), scale = this.current.scale.x;
    await this.tween(kind === 'theme' ? 1800 : 1100, (t) => {
      const angle = kind === 'theme' ? t * Math.PI * 2 : Math.sin(t * Math.PI) * .18;
      this.current.quaternion.copy(pose).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
      this.current.scale.setScalar(scale * (1 - .15 * Math.sin(Math.PI * t)));
    });
    this.current.quaternion.copy(pose); this.current.scale.setScalar(scale);
    this.host.dispatchEvent(new CustomEvent('cube-showcase-end', { detail: { kind, theme: this.theme, face: this.face } }));
  }

  celebrate(full) {
    if (this.reducedMotion) return;
    const colors = ['#eab5a1', '#b6cc9f', '#f1d38a', '#adcbd1', '#d5bdd9'];
    for (let i = 0; i < (full ? 100 : 38); i++) {
      const star = document.createElementNS(svgNS, 'path');
      star.setAttribute('d', starPath); star.setAttribute('fill', colors[i % colors.length]);
      const x = 540 + (Math.random() - .5) * 600, y = full ? 250 + Math.random() * 500 : 920, size = 5 + Math.random() * 6;
      star.setAttribute('transform', `translate(${x} ${y}) scale(${size})`);
      this.effects.appendChild(star);
      this.particles.push({ star, x, y, size, angle: 0, vx: (Math.random() - .5) * 230, vy: full ? Math.random() * 70 : -90 - Math.random() * 200, life: 2 + Math.random() * 2 });
    }
  }

  tileScreen(face, level) {
    const tile = this.tiles[this.theme].find((t) => t.userData.face === face && t.userData.level === level);
    const p = tile.getWorldPosition(new THREE.Vector3()).project(this.camera), r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }

  renderCube() {
    // The orthographic camera looks down -Z. Skip the draw calls for stickers facing away.
    for (const cube of this.models) {
      if (!cube.visible) continue;
      for (const part of cube.children) {
        const { normal, tiles, batch, coverUrl } = part.userData;
        if (!normal) continue;
        part.visible = this.faceNormal.copy(normal).applyQuaternion(cube.quaternion).z > 0;
        if (!part.visible) continue;
        const first = tiles.children[0], complete = first.userData.complete;
        batch.visible = this.mode === 'home' && tiles.children.every(tile => tile.userData.complete === complete);
        tiles.visible = !batch.visible;
        if (batch.visible) {
          batch.geometry = complete ? cube.userData.faceGeometry.cover : cube.userData.faceGeometry.back;
          batch.material.map = complete ? this.art.get(coverUrl)?.texture ?? part.userData.preview : first.material.map;
        }
      }
    }
    // Parents precede children. Only the cubes and sticker groups being drawn
    // need fresh world matrices for this frame.
    this.scene.traverseVisible(object => object.updateWorldMatrix(false, false));
    this.renderer.render(this.scene, this.camera);
  }

  tick = (time) => {
    this.frame = null;
    if (document.hidden || !this.active || this.contextLost) return;
    this.scheduleFrame();
    const dt = Math.min(.05, (time - (this.lastFrame ?? time)) / 1000); this.lastFrame = time;
    const motion = this.motion;
    if (motion) {
      const t = Math.max(0, Math.min(1, (time - motion.start) / motion.duration));
      motion.update(t);
      if (t === 1) { this.motion = null; this.busy = false; motion.resolve(); }
    } else if (this.mode === 'home' && !this.gesture && !this.reducedMotion) {
      if (time > this.nextSpin) {
        this.targetSpin.set((Math.random() - .5) * .15, (Math.random() - .5) * .20, (Math.random() - .5) * .1);
        this.nextSpin = time + 4500 + Math.random() * 3500;
      }
      this.spin.lerp(this.targetSpin, dt * .6);
      const speed = this.spin.length();
      if (speed > .00001) this.current.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.spin.clone().normalize(), speed * dt));
      this.current.position.y = 35 + Math.sin(time * .00065) * 11;
    }
    const palette = this.arrowTint();
    if (palette !== this.arrowPalette) {
      this.arrowPalette = palette; this.arrowFrom.copy(this.arrowColor); this.arrowTarget.set(palette); this.arrowColorStarted = time;
    }
    const colorTime = this.reducedMotion ? 1 : Math.max(0, Math.min(1, (time - this.arrowColorStarted) / themeSlideMs));
    this.arrowColor.lerpColors(this.arrowFrom, this.arrowTarget, smooth(colorTime));
    this.arrows.forEach((arrow, i) => {
      const dir = i ? 1 : -1;
      arrow.visible = this.active;
      arrow.position.x = dir * (447 + (this.reducedMotion ? 0 : Math.sin(time * .0018) * 8));
      arrow.position.y = 35 + (this.reducedMotion ? 0 : Math.cos(time * .0015) * 5);
      arrow.material.color.copy(this.arrowColor);
    });
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      if (p.life <= 0) { p.star.remove(); this.particles.splice(i, 1); continue; }
      p.vy += 110 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.angle += dt * 180 / Math.PI;
      p.star.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${p.size})`);
      p.star.setAttribute('opacity', Math.min(1, p.life));
    }
    this.renderCube();
    if (!motion) this.updateFaceArt(time);
  };

  destroy() {
    this.cancelFaceArt();
    cancelAnimationFrame(this.frame); this.abort.abort(); this.motion?.resolve();
    for (const url of this.art.keys()) this.releaseFaceArt(url);
    for (const tiles of this.tiles) for (const tile of tiles) tile.userData.preview?.dispose();
    this.previewAtlas?.dispose();
    const geometries = new Set(), materials = new Set();
    for (const cube of this.models) {
      for (const geometry of Object.values(cube.userData.faceGeometry)) geometries.add(geometry);
      for (const part of cube.children) part.userData.preview?.dispose();
    }
    this.scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const texture of this.themeBacks) texture.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove(); this.effects.remove();
  }
}
