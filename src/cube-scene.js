import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Application, Graphics, Container } from 'pixi.js';
import { THEMES, isComplete, faceSize, themeUnlocked, currentTheme, currentFace } from './progress.js';
import { createBackTexture } from './card-back.js';
import { THEME_ART } from './theme-art.js';

const FACE_ROTATIONS = [[0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0], [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0]];
export const faceQuaternion = (face) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_ROTATIONS[face])).invert();
export const homeQuaternion = (face) => new THREE.Quaternion().setFromEuler(new THREE.Euler(.34, -.55, -.10)).multiply(faceQuaternion(face));
const smooth = (t) => t * t * (3 - 2 * t);

function stickerGeometry(size) {
  const h = size / 2, r = size * .075, shape = new THREE.Shape();
  shape.moveTo(-h + r, -h); shape.lineTo(h - r, -h); shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r); shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h); shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r); shape.quadraticCurveTo(-h, -h, -h + r, -h);
  const geo = new THREE.ShapeGeometry(shape, 10), uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / size + .5, uv.getY(i) / size + .5);
  return geo;
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
  constructor(host, progress, callbacks) {
    this.host = host; this.progress = progress; this.callbacks = callbacks;
    this.mode = 'home'; this.theme = currentTheme(progress); this.face = currentFace(progress, this.theme); this.active = true;
    this.busy = true; this.particles = []; this.models = []; this.tiles = [];
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.abort = new AbortController(); this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(); this.spin = new THREE.Vector3(.06, .1, .025); this.targetSpin = this.spin.clone();
  }

  async init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-540, 540, 960, -960, 1, 6000);
    this.camera.position.set(0, 0, 2500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.renderer.domElement.className = 'cube-canvas'; this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xfffcf4, 0xc3bcad, 1.15));
    const key = new THREE.DirectionalLight(0xfff8ed, 1.8); key.position.set(-900, 1400, 1800); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd5e9ed, .65); fill.position.set(1000, -300, 800); this.scene.add(fill);
    this.themeBacks = THEMES.map((_, theme) => createBackTexture(1, theme));
    this.art = new Map(); this.artLoads = new Map();
    for (let i = 0; i < THEMES.length; i++) this.models.push(this.buildCube(i));
    await this.ensureThemeArt(this.theme);
    this.models.forEach((cube, i) => { cube.visible = i === this.theme; this.scene.add(cube); });
    this.current = this.models[this.theme]; this.current.scale.setScalar(460); this.current.position.set(0, 35, 0);
    this.current.quaternion.copy(homeQuaternion(this.face));
    this.makeArrows();
    // Prepare every theme during loading, before a switch can reveal it.
    for (const texture of this.themeBacks) this.renderer.initTexture(texture);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.pixi = new Application();
    await this.pixi.init({ width: 1, height: 1, backgroundAlpha: 0, antialias: true, autoStart: false, preference: 'webgl' });
    this.pixi.canvas.className = 'cube-effects'; this.pixi.canvas.setAttribute('aria-hidden', 'true'); this.host.appendChild(this.pixi.canvas);
    this.resizeRenderers();
    this.decor = new Graphics(); this.particleLayer = new Container(); this.pixi.stage.addChild(this.decor, this.particleLayer);
    this.drawDecor(); this.events(); this.busy = false; this.nextSpin = 0;
    this.scheduleFrame();
  }

  resizeRenderers() {
    if (!this.active || !this.pixi?.renderer) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    const resolution = Math.max(1 / 1080, Math.min(devicePixelRatio, 2) * Math.min(width / 1080, height / 1920, 1));
    if (resolution === this.resolution) return;
    this.resolution = resolution;
    this.renderer.setDrawingBufferSize(1080, 1920, resolution);
    this.pixi.renderer.resize(1080, 1920, resolution);
    this.effectsDirty = true;
  }

  scheduleFrame() {
    if (this.frame == null && this.active && !document.hidden) this.frame = requestAnimationFrame(this.tick);
  }

  setActive(active) {
    this.active = active;
    if (active && !document.hidden) {
      this.resizeRenderers();
      this.scheduleFrame();
    } else {
      this.cancelGesture();
      cancelAnimationFrame(this.frame); this.frame = null; this.lastFrame = null;
    }
  }

  cancelGesture() {
    const pointerId = this.gesture?.pointerId;
    this.gesture = null;
    if (pointerId != null && this.host.hasPointerCapture(pointerId)) this.host.releasePointerCapture(pointerId);
  }

  async loadFaceArt(theme, face) {
    const url = THEMES[theme].faceArt[face];
    if (this.artLoads.has(url)) return this.artLoads.get(url);
    const job = (async () => {
      const texture = await new THREE.TextureLoader().loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      if (this.disposed) { texture.dispose(); return; }
      this.art.set(url, texture);
      const n = THEMES[theme].order;
      for (const tile of this.tiles[theme].filter((t) => t.userData.face === face)) {
        const level = tile.userData.level, map = texture.clone();
        map.repeat.set(1 / n, 1 / n); map.offset.set((level % n) / n, 1 - (Math.floor(level / n) + 1) / n); map.needsUpdate = true;
        tile.userData.picture = map;
        if (tile.userData.complete) { tile.material.map = map; tile.material.needsUpdate = true; }
      }
    })();
    this.artLoads.set(url, job);
    try { await job; } catch (e) { this.artLoads.delete(url); throw e; }
  }

  async ensureThemeArt(theme) {
    if (THEMES[theme].comingSoon) return;
    const revealedFaces = [...new Set(this.tiles[theme].filter((t) => t.userData.complete).map((t) => t.userData.face))];
    await Promise.all(revealedFaces.map((face) => this.loadFaceArt(theme, face)));
  }

  resetProgress(progress) {
    this.progress = progress; this.face = currentFace(progress, this.theme); this.gesture = null;
    for (const tile of this.tiles.flat()) {
      const { theme, face, level } = tile.userData;
      tile.userData.complete = isComplete(progress, theme, face, level);
      tile.material.map = tile.userData.complete && tile.userData.picture ? tile.userData.picture : this.themeBacks[theme];
      tile.material.needsUpdate = true;
    }
    if (this.mode === 'home') this.current.quaternion.copy(homeQuaternion(this.face));
  }

  buildCube(theme) {
    const cube = new THREE.Group(), n = THEMES[theme].order, unit = 1 / n;
    const bodyGeo = new RoundedBoxGeometry(unit * .972, unit * .972, unit * .972, 3, unit * .075);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: THEME_ART[theme].body, roughness: .65, metalness: 0 });
    // All shell blocks share one geometry/material and one draw submission.
    const body = new THREE.InstancedMesh(bodyGeo, bodyMaterial, n ** 3 - Math.max(0, n - 2) ** 3);
    const matrix = new THREE.Matrix4(); let instance = 0;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
      if (x && x < n - 1 && y && y < n - 1 && z && z < n - 1) continue;
      body.setMatrixAt(instance++, matrix.makeTranslation((x + .5) / n - .5, (y + .5) / n - .5, (z + .5) / n - .5));
    }
    body.instanceMatrix.needsUpdate = true; cube.add(body);
    const stickerGeo = stickerGeometry(unit * .899);
    const tileList = [];
    for (let face = 0; face < 6; face++) {
      const surface = new THREE.Group(); surface.rotation.set(...FACE_ROTATIONS[face]);
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
        surface.add(tile); tileList.push(tile);
      }
    }
    this.tiles[theme] = tileList;
    return cube;
  }

  makeArrows() {
    this.arrowTheme = this.theme; this.arrowPalette = THEME_ART[this.theme].fill;
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
    const g = this.decor;
    for (const [x, y, r] of [[172, 533, 15], [908, 570, 12], [923, 1277, 18], [177, 1250, 10]]) g.star(x, y, 4, r, r * .3).stroke({ color: 0xcab89b, width: 2.7 });
    g.moveTo(157, 692).bezierCurveTo(114, 708, 124, 747, 157, 735).bezierCurveTo(190, 719, 137, 691, 125, 725).stroke({ color: 0xc9d3b4, width: 3.5, cap: 'round' });
    for (const [x, y] of [[861, 462], [214, 1420], [854, 1350]]) g.circle(x, y, 6).fill({ color: 0xd6c7ac, alpha: .6 });
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
    this.pixi.canvas.addEventListener('webglcontextrestored', () => { this.effectsDirty = true; this.scheduleFrame(); }, { signal });
  }

  pick(x, y) {
    const r = this.host.getBoundingClientRect();
    this.pointer.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.tiles[this.theme], false).find((hit) => hit.object.visible)?.object;
  }

  tween(duration, update) {
    return new Promise((resolve) => {
      this.motion?.resolve();
      this.motion = { start: performance.now(), duration: this.reducedMotion ? 1 : duration, update, resolve };
      this.busy = true;
    });
  }

  async switchTheme(theme, direction) {
    // Begin recoloring with the background, including while face art is loading.
    this.arrowTheme = theme;
    this.busy = true; await this.ensureThemeArt(theme);
    this.face = currentFace(this.progress, theme);
    const old = this.current, next = this.models[theme], startQuaternion = homeQuaternion(this.face);
    this.theme = theme; next.visible = true; next.scale.setScalar(460); next.position.set(direction * 1350, 35, 0); next.quaternion.copy(startQuaternion);
    await this.tween(680, (t) => {
      const e = smooth(t); old.position.x = -direction * 1350 * e; next.position.x = direction * 1350 * (1 - e);
      old.scale.setScalar(460 - 80 * Math.sin(t * Math.PI)); next.scale.setScalar(460 - 80 * Math.sin(t * Math.PI));
    });
    old.visible = false; next.position.x = 0; next.scale.setScalar(460); this.current = next;
  }

  async enter(face) {
    this.homePose = { quaternion: this.current.quaternion.clone(), position: this.current.position.clone(), scale: this.current.scale.x };
    this.face = face; this.mode = 'chapters';
    const from = this.current.quaternion.clone(), to = faceQuaternion(face), startScale = this.current.scale.x, startY = this.current.position.y;
    await this.tween(1050, (t) => {
      const e = smooth(t); this.current.quaternion.slerpQuaternions(from, to, e);
      this.current.scale.setScalar(startScale + (750 - startScale) * e);
      this.current.position.y = startY * (1 - e) + 35 * e;
    });
  }

  async leave() {
    const from = this.current.quaternion.clone(), startScale = this.current.scale.x, startY = this.current.position.y, pose = this.homePose;
    await this.tween(900, (t) => {
      const e = smooth(t); this.current.quaternion.slerpQuaternions(from, pose.quaternion, e);
      this.current.scale.setScalar(startScale + (pose.scale - startScale) * e);
      this.current.position.y = startY + (pose.position.y - startY) * e;
    });
    this.mode = 'home';
  }

  async turn(face) {
    const from = this.current.quaternion.clone(), to = faceQuaternion(face);
    await this.tween(760, (t) => {
      this.current.quaternion.slerpQuaternions(from, to, smooth(t));
      this.current.scale.setScalar(750 - Math.sin(t * Math.PI) * 145);
    });
    this.face = face; this.current.scale.setScalar(750);
  }

  async reveal(face, level) {
    const tile = this.tiles[this.theme].find((t) => t.userData.face === face && t.userData.level === level);
    if (!tile || tile.userData.complete) return;
    this.busy = true; await this.loadFaceArt(this.theme, face);
    let swapped = false;
    await this.tween(680, (t) => {
      tile.scale.x = Math.max(.025, Math.abs(Math.cos(t * Math.PI)));
      tile.position.z = Math.sin(t * Math.PI) * .03;
      if (t >= .5 && !swapped) { swapped = true; tile.material.map = tile.userData.picture; tile.material.needsUpdate = true; tile.userData.complete = true; }
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
    const colors = [0xeab5a1, 0xb6cc9f, 0xf1d38a, 0xadcbd1, 0xd5bdd9];
    for (let i = 0; i < (full ? 100 : 38); i++) {
      const g = new Graphics().star(0, 0, 4, 5 + Math.random() * 6, 3).fill(colors[i % colors.length]);
      g.x = 540 + (Math.random() - .5) * 600; g.y = full ? 250 + Math.random() * 500 : 920;
      this.particleLayer.addChild(g);
      this.particles.push({ g, vx: (Math.random() - .5) * 230, vy: full ? Math.random() * 70 : -90 - Math.random() * 200, life: 2 + Math.random() * 2 });
    }
  }

  tileScreen(face, level) {
    const tile = this.tiles[this.theme].find((t) => t.userData.face === face && t.userData.level === level);
    this.scene.updateMatrixWorld(true);
    const p = tile.getWorldPosition(new THREE.Vector3()).project(this.camera), r = this.host.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }

  tick = (time) => {
    this.frame = null;
    if (document.hidden || !this.active) return;
    this.scheduleFrame();
    const dt = Math.min(.05, (time - (this.lastFrame ?? time)) / 1000); this.lastFrame = time;
    if (this.motion) {
      const motion = this.motion, t = Math.min(1, (time - motion.start) / motion.duration);
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
    const art = THEME_ART[this.arrowTheme];
    const palette = this.mode === 'home' && !themeUnlocked(this.progress, this.arrowTheme) ? art.border : art.fill;
    if (palette !== this.arrowPalette) {
      this.arrowPalette = palette; this.arrowFrom.copy(this.arrowColor); this.arrowTarget.set(palette); this.arrowColorStarted = time;
    }
    const colorTime = this.reducedMotion ? 1 : Math.max(0, Math.min(1, (time - this.arrowColorStarted) / 800));
    this.arrowColor.lerpColors(this.arrowFrom, this.arrowTarget, smooth(colorTime));
    this.arrows.forEach((arrow, i) => {
      const dir = i ? 1 : -1;
      arrow.visible = this.active;
      arrow.position.x = dir * (447 + (this.reducedMotion ? 0 : Math.sin(time * .0018) * 8));
      arrow.position.y = 35 + (this.reducedMotion ? 0 : Math.cos(time * .0015) * 5);
      arrow.material.color.copy(this.arrowColor);
    });
    const renderEffects = this.effectsDirty || this.particles.length > 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt; p.vy += 110 * dt; p.g.x += p.vx * dt; p.g.y += p.vy * dt; p.g.rotation += dt; p.g.alpha = Math.min(1, p.life);
      if (p.life <= 0) { p.g.destroy(); this.particles.splice(i, 1); }
    }
    this.renderer.render(this.scene, this.camera);
    // The decorative canvas stays on screen without redrawing when it is static.
    if (renderEffects) { this.pixi.render(); this.effectsDirty = false; }
  };

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame); this.abort.abort(); this.motion?.resolve();
    const geometries = new Set(), materials = new Set(), textures = new Set([...this.themeBacks, ...this.art.values()]);
    this.scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); if (o.userData.picture) textures.add(o.userData.picture); });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove(); this.pixi.destroy(true, { children: true });
  }
}
