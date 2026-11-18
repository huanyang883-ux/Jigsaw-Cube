import * as THREE from 'three';
import { Application, Graphics, Container } from 'pixi.js';
import { boardSize, xy, groupFor, groups, linked, clampDelta } from './puzzle.js';
import { pieceBounds } from './piece-geometry.js';
import { createIntroPlan, introPose, INTRO_DURATION } from './intro.js';
import { createBackTexture } from './card-back.js';
import { cardShapeUniforms, updateCardShape, createCardFaceMaterial, createCardShadowMaterial, createCardBodyGeometry, SHADOW_REACH } from './card-surface.js';
import { createMergeFlashMaterial, mergeFlashEnvelope, MERGE_FLASH_DURATION } from './merge-flash.js';

const easeOut = (t) => 1 - (1 - t) ** 3;

export class PuzzleRenderer {
  constructor(host, positions, callbacks, theme = 0) {
    this.host = host;
    this.positions = [...positions];
    this.size = boardSize(positions);
    this.worldSize = this.size + .18;
    this.aspect = 1; this.cellHeight = 1; this.worldHeight = this.worldSize;
    this.callbacks = callbacks;
    this.theme = theme;
    this.cards = [];
    this.mergePulse = null;
    this.particles = [];
    this.busy = true;
    this.blocked = false;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.keyCell = 0;
    this.abort = new AbortController();
  }

  async init(art) {
    this.scene = new THREE.Scene();
    const extent = this.worldSize / 2;
    this.camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, .1, 40);
    this.camera.position.z = 12;
    this.three = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.three.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.three.setClearColor(0x000000, 0);
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.domElement.className = 'puzzle-canvas';
    this.three.domElement.setAttribute('aria-hidden', 'true');
    this.three.domElement.style.cursor = 'grab';
    this.host.appendChild(this.three.domElement);

    this.pixi = new Application();
    await this.pixi.init({ width: 500, height: 500, backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, autoStart: false, preference: 'webgl' });
    this.pixi.canvas.className = 'effects-canvas';
    this.pixi.canvas.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.pixi.canvas);
    this.guides = new Graphics();
    this.particleLayer = new Container();
    this.pixi.stage.addChild(this.guides, this.particleLayer);

    const base = await new THREE.TextureLoader().loadAsync(art);
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = Math.min(4, this.three.capabilities.getMaxAnisotropy());
    this.baseTexture = base;
    this.aspect = base.image.width / base.image.height;
    this.cellHeight = 1 / this.aspect; this.worldHeight = this.worldSize * this.cellHeight;
    this.camera.top = this.worldHeight / 2; this.camera.bottom = -this.worldHeight / 2;
    this.camera.updateProjectionMatrix();
    const box = createCardBodyGeometry(this.cellHeight);
    const face = new THREE.PlaneGeometry(.978, .978 * this.cellHeight);
    const edge = new THREE.MeshBasicMaterial({ vertexColors: true });
    const backShape = cardShapeUniforms();
    updateCardShape(backShape, { left: -.489, right: .489, bottom: -.489 * this.cellHeight, top: .489 * this.cellHeight, joins: {} });
    const back = createCardFaceMaterial(createBackTexture(this.aspect, this.theme), backShape);
    for (let id = 0; id < this.positions.length; id++) {
      const mesh = new THREE.Mesh(box, edge);
      mesh.userData.piece = id;
      const shape = cardShapeUniforms();
      const picture = new THREE.Mesh(new THREE.PlaneGeometry(1, this.cellHeight), createCardFaceMaterial(base, shape));
      picture.userData.piece = id;
      picture.position.z = .031;
      mesh.add(picture);
      // Share the photo geometry so a joined group's white wash has no seams.
      const flash = new THREE.Mesh(picture.geometry, createMergeFlashMaterial(this.reducedMotion, shape));
      flash.position.z = .001; flash.visible = false; picture.add(flash);
      const reverse = new THREE.Mesh(face, back);
      reverse.rotation.y = Math.PI;
      reverse.position.z = -.031;
      mesh.add(reverse);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, this.cellHeight), createCardShadowMaterial(shape));
      const p = this.world(this.positions[id]);
      mesh.position.set(p.x, p.y, 0);
      shadow.position.set(p.x + .018, p.y - .026, -.065);
      this.cards.push({ mesh, shadow, picture, flash, shape, flashStart: null });
      this.scene.add(shadow, mesh);
    }
    this.updateJoinedEdges();
    this.resizeObserver = new ResizeObserver(() => { this.cancelDrag(); this.resize(); });
    this.resizeObserver.observe(this.host);
    this.resize();
    this.events();
    this.callbacks.onReady?.();
    const entrance = this.setPositions(this.positions, { intro: true });
    this.lastFrame = performance.now(); this.animate(this.lastFrame);
    await entrance;
  }

  updateJoinedEdges() {
    this.cards.forEach(({ picture, shadow, shape }, id) => {
      const b = pieceBounds(this.positions, id, this.aspect), p = picture.geometry.attributes.position, uv = picture.geometry.attributes.uv;
      updateCardShape(shape, b);
      // The concave arc crosses the old straight-edge crop. Cover the cell
      // and let the shared contour mask trim it, retaining exact photo UVs.
      const concave = b.corners.some(Boolean), home = xy(id, this.size);
      const left = concave ? Math.min(b.left, -.5) : b.left, right = concave ? Math.max(b.right, .5) : b.right;
      const top = concave ? Math.max(b.top, .5 * this.cellHeight) : b.top, bottom = concave ? Math.min(b.bottom, -.5 * this.cellHeight) : b.bottom;
      p.setXYZ(0, left, top, 0); p.setXYZ(1, right, top, 0);
      p.setXYZ(2, left, bottom, 0); p.setXYZ(3, right, bottom, 0);
      const u0 = (home.x + .5 + left) / this.size, u1 = (home.x + .5 + right) / this.size;
      const v0 = 1 - (home.y + .5 - bottom / this.cellHeight) / this.size, v1 = 1 - (home.y + .5 - top / this.cellHeight) / this.size;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1);
      uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      p.needsUpdate = true; uv.needsUpdate = true;
      picture.geometry.computeBoundingSphere();
      // Cut shadows exactly at shared edges; only outside edges need a blur
      // margin. Adjacent pieces then form one shadow without darker seams.
      const s = shadow.geometry.attributes.position;
      const shadowLeft = b.joins.left ? -.5 : b.left - SHADOW_REACH, shadowRight = b.joins.right ? .5 : b.right + SHADOW_REACH;
      const shadowTop = b.joins.top ? .5 * this.cellHeight : b.top + SHADOW_REACH, shadowBottom = b.joins.bottom ? -.5 * this.cellHeight : b.bottom - SHADOW_REACH;
      s.setXYZ(0, shadowLeft, shadowTop, 0); s.setXYZ(1, shadowRight, shadowTop, 0); s.setXYZ(2, shadowLeft, shadowBottom, 0); s.setXYZ(3, shadowRight, shadowBottom, 0);
      s.needsUpdate = true; shadow.geometry.computeBoundingSphere();
    });
  }
  world(cell) { const p = xy(cell, this.size), half = (this.size - 1) / 2; return { x: p.x - half, y: (half - p.y) * this.cellHeight }; }
  screen(world) { return { x: (world.x / this.worldSize + .5) * this.width, y: (.5 - world.y / this.worldHeight) * this.height }; }
  resize() {
    if (!this.three || !this.pixi?.renderer) return;
    this.width = this.host.clientWidth; this.height = this.host.clientHeight;
    const scale = this.host.getBoundingClientRect().width / this.width;
    const resolution = Math.min(devicePixelRatio, 2) * scale;
    this.three.setPixelRatio(resolution);
    this.three.setSize(this.width, this.height, false);
    this.pixi.renderer.resolution = resolution;
    this.pixi.renderer.resize(this.width, this.height);
  }
  eventWorld(event) {
    const rect = this.three.domElement.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width - .5) * this.worldSize, y: (.5 - (event.clientY - rect.top) / rect.height) * this.worldHeight };
  }
  hit(event) {
    const rect = this.three.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // The joined photo extends over the small gaps between rounded card bodies.
    return this.raycaster.intersectObjects(this.cards.flatMap((c) => [c.mesh, c.picture]), false)[0]?.object.userData.piece;
  }

  events() {
    const canvas = this.three.domElement, signal = this.abort.signal;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.busy || this.blocked || this.drag || e.button !== 0) return;
      const id = this.hit(e);
      if (id === undefined) return;
      e.preventDefault();
      this.host.focus({ preventScroll: true });
      this.keyboard = false;
      this.startDrag(id, this.eventWorld(e), e.pointerId);
      canvas.setPointerCapture(e.pointerId);
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      if (e.pointerId !== this.drag.pointerId) return;
      const point = this.eventWorld(e);
      this.dragDelta(point.x - this.drag.start.x, (this.drag.start.y - point.y) / this.cellHeight);
    }, { signal });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      if (e.clientX < rect.left - 15 || e.clientX > rect.right + 15 || e.clientY < rect.top - 15 || e.clientY > rect.bottom + 15) this.cancelDrag();
      else this.endDrag();
    }, { signal });
    canvas.addEventListener('pointercancel', () => this.cancelDrag(), { signal });
    canvas.addEventListener('lostpointercapture', () => this.cancelDrag(), { signal });
    window.addEventListener('blur', () => this.cancelDrag(), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancelDrag();
    }, { signal });
    this.host.addEventListener('keydown', (e) => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (![...Object.keys(directions), ' ', 'Enter', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      if (this.busy || this.blocked) return;
      this.keyboard = true;
      if (e.key === 'Escape') { this.cancelDrag(); return; }
      if (directions[e.key]) {
        const [dx, dy] = directions[e.key];
        if (this.drag) this.dragDelta(this.drag.delta.x + dx, this.drag.delta.y + dy);
        else {
          const p = xy(this.keyCell, this.size);
          this.keyCell = Math.max(0, Math.min(this.size - 1, p.y + dy)) * this.size + Math.max(0, Math.min(this.size - 1, p.x + dx));
        }
      } else if (this.drag) this.endDrag();
      else this.startDrag(this.positions.indexOf(this.keyCell), { x: 0, y: 0 }, null);
    }, { signal });
    this.host.addEventListener('blur', () => { this.cancelDrag(); this.keyboard = false; }, { signal });
  }

  startDrag(id, start, pointerId) {
    this.clearMergeFeedback();
    this.hint = null;
    this.drag = { id, ids: groupFor(this.positions, id), start, pointerId, delta: { x: 0, y: 0 } };
    this.three.domElement.style.cursor = 'grabbing';
    this.callbacks.onGrab?.();
    this.dragDelta(0, 0);
  }
  dragDelta(dx, dy) {
    if (!this.drag) return;
    if (!this.drag.moved && Math.hypot(dx, dy) > .06) { this.drag.moved = true; this.callbacks.onDrag?.(); }
    const d = clampDelta(this.positions, this.drag.ids, dx, dy);
    this.drag.delta = d;
    const excessX = dx - d.x, excessY = dy - d.y;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      Math.max(-.12, Math.min(.12, excessY * .16)),
      Math.max(-.12, Math.min(.12, excessX * .16)), 0,
    ));
    const pivot = new THREE.Vector3();
    this.drag.ids.forEach((id) => { const p = this.world(this.positions[id]); pivot.x += p.x; pivot.y += p.y; });
    pivot.divideScalar(this.drag.ids.length);
    const nudgeX = Math.tanh(excessX) * .045, nudgeY = Math.tanh(excessY) * .045 * this.cellHeight;
    this.drag.ids.forEach((id) => {
      const p = this.world(this.positions[id]), card = this.cards[id];
      const offset = new THREE.Vector3(p.x - pivot.x, p.y - pivot.y, 0).applyQuaternion(tilt);
      card.mesh.position.set(pivot.x + offset.x + d.x + nudgeX, pivot.y + offset.y - d.y * this.cellHeight - nudgeY, .23 + offset.z);
      card.mesh.quaternion.copy(tilt);
      card.shadow.position.set(p.x + d.x + .04, p.y - d.y * this.cellHeight - .06, .12);
      card.shadow.material.opacity = .17;
    });
  }
  releaseCapture() {
    const id = this.drag?.pointerId;
    this.drag = null;
    if (id !== null && id !== undefined && this.three.domElement.hasPointerCapture(id)) this.three.domElement.releasePointerCapture(id);
    this.three.domElement.style.cursor = 'grab';
  }
  endDrag() {
    if (!this.drag) return;
    const { id, delta } = this.drag;
    this.releaseCapture();
    this.callbacks.onDrop(id, Math.round(delta.x), Math.round(delta.y));
  }
  cancelDrag() {
    if (!this.drag) return;
    this.releaseCapture();
    this.setPositions(this.positions);
  }
  setBlocked(value) { this.blocked = value; if (value) this.cancelDrag(); }

  setPositions(positions, { intro = false, instant = false } = {}) {
    this.clearMergeFeedback();
    this.releaseCapture();
    this.hint = null;
    const tiltedGroups = groups(this.positions).filter((ids) => this.cards[ids[0]].mesh.quaternion.angleTo(new THREE.Quaternion()) > .00001);
    this.positions = [...positions];
    this.animation?.resolve();
    const sources = this.cards.map((card) => card.mesh.position.clone());
    const rotations = this.cards.map((card) => card.mesh.quaternion.clone());
    const pivots = new Map();
    for (const ids of tiltedGroups) {
      const from = new THREE.Vector3(), to = new THREE.Vector3();
      for (const id of ids) { from.add(sources[id]); const p = this.world(positions[id]); to.add(new THREE.Vector3(p.x, p.y, 0)); }
      from.divideScalar(ids.length); to.divideScalar(ids.length);
      for (const id of ids) { const p = this.world(positions[id]); pivots.set(id, { from, to, relative: new THREE.Vector3(p.x, p.y, 0).sub(to) }); }
    }
    const introPlan = intro ? createIntroPlan(this.cards.length) : null;
    if (intro) {
      this.cards.forEach((card, id) => {
        const p = this.world(positions[id]);
        card.mesh.position.set(p.x, p.y, 0);
        card.mesh.rotation.set(0, introPlan[id].direction * Math.PI, 0);
        sources[id] = card.mesh.position.clone();
      });
    }
    this.busy = true;
    return new Promise((resolve) => {
      this.animation = { start: performance.now(), duration: instant || this.reducedMotion ? 1 : intro ? INTRO_DURATION : 230, sources, rotations, pivots, intro, introPlan, resolve };
    });
  }

  showHint(hint) { this.clearMergeFeedback(); this.hint = hint; }

  clearMergeFeedback() {
    if (this.mergePulse) for (const { ids } of this.mergePulse.groups) for (const id of ids) {
      const card = this.cards[id], p = this.world(this.positions[id]);
      card.mesh.scale.set(1, 1, 1); card.mesh.position.set(p.x, p.y, 0);
      card.shadow.scale.set(1, 1, 1); card.shadow.position.set(p.x + .018, p.y - .026, -.065);
    }
    this.mergePulse = null;
    for (const card of this.cards) {
      if (card.flashStart === null) continue;
      card.flashStart = null; card.flash.material.opacity = 0; card.flash.material.uniforms.uStrength.value = 0; card.flash.visible = false;
    }
  }

  flashGroups(connectedGroups) {
    this.clearMergeFeedback();
    const start = performance.now();
    const pulses = connectedGroups.map((ids) => {
      const center = new THREE.Vector2();
      const min = new THREE.Vector2(Infinity, Infinity), max = new THREE.Vector2(-Infinity, -Infinity);
      for (const id of ids) {
        const p = this.world(this.positions[id]); center.x += p.x; center.y += p.y;
        const uv = this.cards[id].picture.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          min.x = Math.min(min.x, uv.getX(i)); min.y = Math.min(min.y, uv.getY(i));
          max.x = Math.max(max.x, uv.getX(i)); max.y = Math.max(max.y, uv.getY(i));
        }
      }
      for (const id of ids) {
        const card = this.cards[id];
        const uniforms = card.flash.material.uniforms;
        uniforms.uMin.value.copy(min); uniforms.uSize.value.copy(max).sub(min);
        uniforms.uStrength.value = 0; uniforms.uPhase.value = 0;
        card.flashStart = start; card.flash.material.opacity = 0; card.flash.visible = true;
      }
      return { ids: [...ids], center: center.divideScalar(ids.length) };
    });
    this.mergePulse = { groups: pulses, start };
  }

  celebrate() {
    if (this.reducedMotion) return;
    const palette = [0xa4bd7b, 0xf1c275, 0xe8ab90, 0xa6c9d2, 0xd8ca87];
    for (let i = 0; i < 90; i++) {
      const g = new Graphics();
      if (i % 3 === 0) g.star(0, 0, 4, 5, 2).fill(palette[i % palette.length]);
      else g.roundRect(-2.5, -4, 5, 8, 2).fill(palette[i % palette.length]);
      g.x = Math.random() * this.width; g.y = -12 - Math.random() * 80;
      this.particleLayer.addChild(g);
      this.particles.push({ g, vx: (Math.random() - .5) * 65, vy: 35 + Math.random() * 80, life: 4, spin: (Math.random() - .5) * 5 });
    }
  }

  drawOverlay(time) {
    const guide = this.guides.clear(), unit = this.width / this.worldSize, unitY = this.height / this.worldHeight * this.cellHeight;
    if (this.animation?.intro) return;
    const hint = this.hint;
    const active = this.drag ?? (hint ? { id: hint.id, ids: groupFor(this.positions, hint.id), delta: { x: hint.dx, y: hint.dy } } : null);
    if (active) {
      const alpha = hint ? .65 + Math.sin(time / 140) * .25 : .55;
      for (const id of active.ids) {
        const world = this.world(this.positions[id]);
        world.x += Math.round(active.delta.x); world.y -= Math.round(active.delta.y) * this.cellHeight;
        const p = this.screen(world), half = unit * .5, halfY = unitY * .5, home = xy(id, this.size);
        const edges = [
          { neighbor: home.x > 0 ? id - 1 : -1, a: [-half, -halfY], b: [-half, halfY] },
          { neighbor: home.x < this.size - 1 ? id + 1 : -1, a: [half, -halfY], b: [half, halfY] },
          { neighbor: home.y > 0 ? id - this.size : -1, a: [-half, -halfY], b: [half, -halfY] },
          { neighbor: home.y < this.size - 1 ? id + this.size : -1, a: [-half, halfY], b: [half, halfY] },
        ];
        for (const edge of edges) {
          if (active.ids.includes(edge.neighbor) && linked(this.positions, id, edge.neighbor)) continue;
          guide.moveTo(p.x + edge.a[0], p.y + edge.a[1]).lineTo(p.x + edge.b[0], p.y + edge.b[1]);
        }
      }
      guide.stroke({ width: 3, color: 0xe7be6e, alpha, cap: 'round', join: 'round' });
      if (hint) {
        const from = this.screen(this.world(this.positions[hint.id]));
        const target = { x: from.x + hint.dx * unit, y: from.y + hint.dy * unitY };
        guide.circle(from.x, from.y, unit * .15).fill({ color: 0xfff8d9, alpha: .94 }).stroke({ color: 0xd1aa5c, width: 2 });
        guide.moveTo(from.x, from.y).lineTo(target.x, target.y).stroke({ color: 0xfff8d9, width: 5, cap: 'round' });
        const angle = Math.atan2(target.y - from.y, target.x - from.x);
        guide.moveTo(target.x - Math.cos(angle - .6) * 13, target.y - Math.sin(angle - .6) * 13).lineTo(target.x, target.y).lineTo(target.x - Math.cos(angle + .6) * 13, target.y - Math.sin(angle + .6) * 13).stroke({ color: 0xfff8d9, width: 5, cap: 'round', join: 'round' });
      }
    }
    if (this.keyboard && !active) {
      const p = this.screen(this.world(this.keyCell)), half = unit * .47, halfY = unitY * .47;
      guide.roundRect(p.x - half, p.y - halfY, half * 2, halfY * 2, 6).stroke({ color: 0xfff4b1, width: 4 });
    }
  }

  animate = (time) => {
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min((time - this.lastFrame) / 1000, .05); this.lastFrame = time;
    if (document.hidden) return;
    if (this.animation) {
      const animation = this.animation;
      const t = Math.max(0, Math.min((time - animation.start) / animation.duration, 1));
      this.cards.forEach((card, id) => {
        const target = this.world(this.positions[id]);
        const start = animation.sources[id], v = easeOut(t);
        if (animation.intro) {
          const pose = introPose(t * INTRO_DURATION, animation.introPlan[id]);
          card.mesh.position.set(target.x + pose.x, target.y + pose.y * this.cellHeight, pose.z);
          card.mesh.rotation.set(pose.rx, pose.ry, pose.rz);
        } else {
          card.mesh.position.set(start.x + (target.x - start.x) * v, start.y + (target.y - start.y) * v, start.z * (1 - v));
          card.mesh.quaternion.slerpQuaternions(animation.rotations[id], new THREE.Quaternion(), v);
          const pivot = animation.pivots.get(id);
          if (pivot) card.mesh.position.lerpVectors(pivot.from, pivot.to, v).add(pivot.relative.clone().applyQuaternion(card.mesh.quaternion));
        }
        card.shadow.position.set(card.mesh.position.x + .018, card.mesh.position.y - .026, -.065);
        card.shadow.material.opacity = .12;
      });
      if (t === 1) {
        this.cards.forEach((card, id) => {
          const p = this.world(this.positions[id]);
          card.mesh.position.set(p.x, p.y, 0);
          card.mesh.rotation.set(0, 0, 0);
        });
        this.updateJoinedEdges();
        this.busy = false; this.animation = null; animation.resolve();
      }
    }
    for (const card of this.cards) {
      if (card.flashStart === null) continue;
      const t = Math.max(0, Math.min(1, (time - card.flashStart) / MERGE_FLASH_DURATION));
      card.flash.material.opacity = (this.reducedMotion ? .12 : .24) * mergeFlashEnvelope(t);
      card.flash.material.uniforms.uStrength.value = card.flash.material.opacity;
      card.flash.material.uniforms.uPhase.value = t;
      if (t === 1) { card.flashStart = null; card.flash.material.opacity = 0; card.flash.visible = false; }
    }
    if (this.mergePulse) {
      const { groups, start } = this.mergePulse;
      const t = Math.max(0, Math.min(1, (time - start) / MERGE_FLASH_DURATION));
      const pulse = this.reducedMotion ? 0 : mergeFlashEnvelope(t), scale = 1 + .03 * pulse;
      // Scale each group around its own center, including spacing between tiles,
      // so the connected photo and its outline remain a continuous surface.
      for (const { ids, center } of groups) for (const id of ids) {
        const card = this.cards[id], p = this.world(this.positions[id]);
        card.mesh.scale.set(scale, scale, 1);
        card.mesh.position.set(center.x + (p.x - center.x) * scale, center.y + (p.y - center.y) * scale, .04 * pulse);
        card.shadow.scale.set(scale, scale, 1);
        card.shadow.position.set(card.mesh.position.x + .018, card.mesh.position.y - .026, -.065);
      }
      if (t === 1) this.clearMergeFeedback();
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt; p.vy += 22 * dt;
      p.g.x += p.vx * dt; p.g.y += p.vy * dt; p.g.rotation += p.spin * dt;
      p.g.alpha = Math.min(1, p.life / 1.4);
      if (p.life <= 0) { this.particleLayer.removeChild(p.g); p.g.destroy(); this.particles.splice(i, 1); }
    }
    this.drawOverlay(time);
    this.three.render(this.scene, this.camera);
    this.pixi.render();
  };

  destroy() {
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.animation?.resolve();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene?.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    for (const mat of materials) { if (mat.map) textures.add(mat.map); mat.dispose(); }
    for (const geo of geometries) geo.dispose();
    for (const tex of textures) tex.dispose();
    this.baseTexture?.dispose();
    this.three?.dispose();
    this.three?.forceContextLoss();
    this.three?.domElement.remove();
    this.pixi?.destroy(true, { children: true });
  }
}
