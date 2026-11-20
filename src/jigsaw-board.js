import './jigsaw-board.css';
import { stageResolution } from './render-resolution.js';
import { WinConfetti } from './win-confetti.js';
import { bindButtonTap } from './button-tap.js';
import { MERGE_FLASH_DURATION } from './merge-flash.js';

const SVG = 'http://www.w3.org/2000/svg';
const LAND_MS = 195;
// Height of the held group above its position on the table, in cell units.
const LIFT = .06;
let nextBoard = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toolIcon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const edgeIcon = toolIcon('<path d="M2.5 17V2.5H17" stroke-width="2.5"/><path d="M6 6h13v4h-1.5a2.25 2.25 0 1 0 0 4.5H19V19h-4.5v-1.5a2.25 2.25 0 1 0-4.5 0V19H6Z"/>');
const arrowIcon = toolIcon('<path d="m9 5 7 7-7 7"/>');

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// Preserve the existing SVG instances and their animations on successive moves.
function syncChildren(parent, ordered) {
  const keep = new Set(ordered);
  for (const old of [...parent.children]) if (!keep.has(old)) old.remove();
  let next = parent.firstElementChild;
  for (const node of ordered) {
    if (node === next) next = next.nextElementSibling;
    else parent.insertBefore(node, next);
  }
}

export class JigsawBoard {
  constructor(host, { model, imageUrl, onChange, onWin, onPreviewChange }) {
    this.host = host;
    this.model = model;
    this.onChange = onChange;
    this.onWin = onWin;
    this.onPreviewChange = onPreviewChange;
    this.prefix = `jigsaw-${++nextBoard}-`;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.touches = new Map();
    this.stamps = new Map();
    this.trayButtons = new Map();
    this.events = new AbortController();
    this.mount(imageUrl);
    this.render();
    this.resize();
    host.addEventListener('pointerdown', (e) => this.pointerDown(e), { signal: this.events.signal });
    host.addEventListener('pointermove', (e) => this.pointerMove(e), { signal: this.events.signal });
    host.addEventListener('pointerup', (e) => this.pointerUp(e), { signal: this.events.signal });
    host.addEventListener('pointercancel', () => this.cancelDrag(), { signal: this.events.signal });
    host.addEventListener('lostpointercapture', (e) => {
      if (e.target === host && this.touches.has(e.pointerId) && !host.hasPointerCapture(e.pointerId)) this.cancelDrag();
    }, { signal: this.events.signal });
    host.addEventListener('wheel', (e) => this.wheel(e), { passive: false, signal: this.events.signal });
    bindButtonTap(host, button => this.toolClick(button), this.events.signal);
    host.addEventListener('keydown', (e) => this.keyDown(e), { signal: this.events.signal });
    this.tray.addEventListener('scroll', () => this.updateTrayButtons(), { signal: this.events.signal });
  }

  mount(imageUrl) {
    const { host, model } = this;
    host.classList.add('jb-workspace');
    host.innerHTML = `
      <div class="jb-window" tabindex="0" role="application" aria-label="拼图桌。拖动碎片，双指缩放。键盘可在碎片上按回车拿起，方向键移动，回车放下。">
        <div class="jb-plane">
          <svg class="jb-surface" viewBox="0 0 ${model.cols} ${model.rows}" aria-hidden="true">
            <defs></defs><g class="jb-lines"></g>
            <image class="jb-reference" width="${model.cols}" height="${model.rows}"></image>
            <g class="jb-pieces"></g><g class="jb-sheen" pointer-events="none"></g>
          </svg>
        </div>
      </div>
      <section class="jb-dock" aria-label="碎片盘">
        <div class="jb-tray-row">
          <button type="button" class="jb-filter" data-tool="edge" aria-label="只看边缘碎片" aria-pressed="false">${edgeIcon}</button>
          <button type="button" class="jb-scroll jb-prev" data-tool="prev" aria-label="上一组碎片">${arrowIcon}</button>
          <div class="jb-tray" role="group" aria-label="可取用的碎片"></div>
          <button type="button" class="jb-scroll" data-tool="next" aria-label="下一组碎片">${arrowIcon}</button>
        </div>
      </section>
      <svg class="jb-float" viewBox="0 0 1080 1920" aria-hidden="true"><g></g></svg>`;
    this.win = host.querySelector('.jb-window');
    this.plane = host.querySelector('.jb-plane');
    this.confetti = new WinConfetti(this.plane);
    this.tray = host.querySelector('.jb-tray');
    this.dock = host.querySelector('.jb-dock');
    this.layer = host.querySelector('.jb-pieces');
    this.float = host.querySelector('.jb-float g');
    const defs = host.querySelector('defs');
    const lines = host.querySelector('.jb-lines');
    this.sheen = host.querySelector('.jb-sheen');
    this.sheenClip = svgNode('clipPath', { id: this.prefix + 'sheen-clip' });
    const gradient = svgNode('radialGradient', { id: this.prefix + 'sheen-light' });
    for (const [offset, opacity] of [[0, .08], [.57, .13], [.81, .42], [1, 0]]) {
      gradient.append(svgNode('stop', { offset, 'stop-color': '#fffbf2', 'stop-opacity': opacity }));
    }
    defs.append(this.sheenClip, gradient);
    this.sheen.setAttribute('clip-path', `url(#${this.sheenClip.id})`);
    const imgId = `${this.prefix}image`;
    defs.append(svgNode('image', { id: imgId, href: imageUrl, width: model.cols, height: model.rows, preserveAspectRatio: 'none' }));
    host.querySelector('.jb-reference').setAttribute('href', imageUrl);
    for (const piece of model.pieces) {
      const clipId = `${this.prefix}cut-${piece.id}`;
      const clip = svgNode('clipPath', { id: clipId });
      clip.append(svgNode('path', { id: this.prefix + 'outline-' + piece.id, d: piece.path }));
      const fragment = svgNode('g', { id: this.pieceId(piece.id) });
      const cut = svgNode('g', { 'clip-path': `url(#${clipId})` });
      cut.append(svgNode('use', { href: `#${imgId}`, x: -piece.col, y: -piece.row }));
      fragment.append(cut, svgNode('path', {
        d: piece.path, fill: 'none', stroke: '#463b35', 'stroke-opacity': '.5', 'stroke-width': '.011', 'stroke-linejoin': 'round',
      }));
      defs.append(clip, fragment);
      lines.append(svgNode('path', { d: piece.path, transform: `translate(${piece.col} ${piece.row})` }));
    }
  }

  pieceId(id) { return this.prefix + id; }

  stamp(piece, x, y) {
    return svgNode('use', { href: `#${this.pieceId(piece.id)}`, x, y });
  }

  renderPieces() {
    const { model } = this;
    const layerOrder = p => p.locked ? 0 : p.group === this.frontGroup ? 2 : 1;
    const pieces = model.pieces.filter(p => p.x !== null).sort((a, b) => layerOrder(a) - layerOrder(b));
    syncChildren(this.layer, pieces.map(p => {
      let stamp = this.stamps.get(p.id);
      if (!stamp) {
        stamp = this.stamp(p, p.x, p.y);
        this.stamps.set(p.id, stamp);
      }
      if (stamp.getAttribute('x') !== String(p.x)) stamp.setAttribute('x', p.x);
      if (stamp.getAttribute('y') !== String(p.y)) stamp.setAttribute('y', p.y);
      if (!p.locked && !stamp.hasAttribute('data-piece')) {
        stamp.dataset.piece = p.id;
        stamp.setAttribute('tabindex', '0');
        stamp.setAttribute('role', 'button');
        stamp.setAttribute('aria-label', `拿起第 ${p.id + 1} 片`);
      } else if (p.locked && stamp.hasAttribute('data-piece')) {
        for (const key of ['data-piece', 'tabindex', 'role', 'aria-label']) stamp.removeAttribute(key);
      }
      return stamp;
    }));

  }

  render({ updatePieces = true } = {}) {
    const { model } = this;
    if (updatePieces) this.renderPieces();
    const available = model.trayOrder.map(id => model.pieces[id]).filter(p => p.x === null);
    const trayPieces = this.edgesOnly ? available.filter(p => p.edge) : available;
    syncChildren(this.tray, trayPieces.map(p => {
      if (this.trayButtons.has(p.id)) return this.trayButtons.get(p.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jb-piece';
      button.dataset.piece = p.id;
      button.setAttribute('aria-label', `${p.edge ? '边缘' : '内部'}碎片，第 ${p.id + 1} 片`);
      const svg = svgNode('svg', { viewBox: '-.32 -.32 1.64 1.64', 'aria-hidden': true });
      svg.append(this.stamp(p, 0, 0));
      button.append(svg);
      this.trayButtons.set(p.id, button);
      return button;
    }));
    this.tray.setAttribute('aria-label', `${this.edgesOnly ? '可取用的边缘碎片' : '可取用的碎片'}，共 ${trayPieces.length} 片`);
    this.updateTrayButtons();
  }

  updateTrayButtons() {
    this.host.querySelector('[data-tool="prev"]').disabled = this.tray.scrollLeft <= 1;
    this.host.querySelector('[data-tool="next"]').disabled = this.tray.scrollLeft + this.tray.clientWidth >= this.tray.scrollWidth - 1;
  }

  getImageRect() { return this.plane.getBoundingClientRect(); }
  get busy() { return Boolean(this.drag || this.pinch); }
  get emptyEdgeTray() {
    return this.edgesOnly && !this.tray.firstElementChild && !this.previewing && !this.keyboard && !this.blocked;
  }

  boardPoint(x, y) {
    const v = this.view, cell = v.cell * this.zoom * v.scale;
    return {
      x: this.model.cols / 2 + (x - v.cx - this.pan.x * v.scale) / cell,
      y: this.model.rows / 2 + (y - v.cy - this.pan.y * v.scale) / cell,
    };
  }

  setZoom(value, anchorX, anchorY) {
    const v = this.view;
    if (!v) return;
    const factor = value / this.zoom;
    this.pan.x = this.pan.x * factor + (1 - factor) * ((anchorX ?? v.cx) - v.cx) / v.scale;
    this.pan.y = this.pan.y * factor + (1 - factor) * ((anchorY ?? v.cy) - v.cy) / v.scale;
    this.zoom = value;
    this.applyView();
  }

  applyView() {
    // A flight uses stage coordinates. Settle it before changing the camera.
    this.finishFlight();
    const v = this.view;
    const maxX = Math.max(0, (v.boardWidth * this.zoom - v.windowWidth) / 2 + 28);
    const maxY = Math.max(0, (v.boardHeight * this.zoom - v.windowHeight) / 2 + 28);
    this.pan.x = clamp(this.pan.x, -maxX, maxX);
    this.pan.y = clamp(this.pan.y, -maxY, maxY);
    this.plane.style.transform = `translate(-50%, -50%) translate3d(${this.pan.x}px, ${this.pan.y}px, 0) scale(${this.zoom})`;
  }

  resize() {
    const host = this.host.getBoundingClientRect(), windowRect = this.win.getBoundingClientRect();
    if (!host.width || !windowRect.width) return;
    const scale = host.width / this.host.offsetWidth;
    const boardWidth = this.plane.offsetWidth;
    this.view = {
      host, windowRect, scale, boardWidth, boardHeight: this.plane.offsetHeight,
      cx: windowRect.left + windowRect.width / 2, cy: windowRect.top + windowRect.height / 2,
      windowWidth: windowRect.width / scale, windowHeight: windowRect.height / scale,
      cell: boardWidth / this.model.cols,
    };
    this.confetti.resize(boardWidth, this.view.boardHeight, stageResolution(scale));
    this.applyView();
    this.updateTrayButtons();
  }

  hitWindow(x, y) {
    const r = this.view.windowRect;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  pointerDown(e) {
    if (this.blocked || this.previewing || !this.view || e.button !== 0 || e.target.closest('[data-tool]')) return;
    const flyingPiece = e.target.closest('.jb-regrabbable [data-flight-piece]');
    const pieceNode = flyingPiece ?? e.target.closest('[data-piece]');
    const trayTarget = this.tray.contains(e.target);
    const inWindow = this.win.contains(e.target) || (flyingPiece && this.hitWindow(e.clientX, e.clientY));
    if (!trayTarget && !inWindow) return;
    if (this.touches.size >= 2 || (this.touches.size && (!inWindow || this.drag?.tray))) return;
    e.preventDefault();
    const point = { x: e.clientX, y: e.clientY };
    this.touches.set(e.pointerId, point);
    this.host.setPointerCapture(e.pointerId);
    if (this.touches.size === 2) {
      this.finishFlight();
      this.clearDrag();
      this.pinch = { ...this.touchPair(), zoom: this.zoom, pan: { ...this.pan } };
      return;
    }
    this.cancelKeyboard();
    const id = pieceNode ? Number(pieceNode.dataset.flightPiece ?? pieceNode.dataset.piece) : null;
    let offset = { x: .5, y: .5 };
    if (pieceNode) {
      if (trayTarget) {
        const r = pieceNode.querySelector('svg').getBoundingClientRect();
        offset = { x: (e.clientX - r.left) / r.width * 1.64 - .32, y: (e.clientY - r.top) / r.height * 1.64 - .32 };
      } else {
        const p = this.boardPoint(point.x, point.y), piece = this.model.pieces[id];
        let x = piece.x, y = piece.y;
        if (flyingPiece) {
          const rect = this.float.ownerSVGElement.getBoundingClientRect();
          const corner = this.boardPoint(rect.left, rect.top), anchor = this.model.pieces[this.ghostId];
          x = corner.x - this.ghostOrigin.x + piece.col - anchor.col;
          y = corner.y - this.ghostOrigin.y + piece.row - anchor.row;
        }
        offset = { x: p.x - x, y: p.y - y };
      }
    }
    this.finishFlight();
    this.drag = { id, pointerId: e.pointerId, pointerType: e.pointerType, start: point, offset, tray: trayTarget,
      trayTop: trayTarget ? this.tray.getBoundingClientRect().top : null,
      scrollLeft: this.tray.scrollLeft, pan: { ...this.pan }, kind: 'pending' };
  }

  touchPair() {
    const [a, b] = this.touches.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  pointerMove(e) {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.gestureFrame == null) {
      this.gestureFrame = requestAnimationFrame(() => {
        this.gestureFrame = null;
        this.updateGesture();
      });
    }
  }

  updateGesture() {
    const v = this.view, stageScale = v.scale;
    if (this.pinch && this.touches.size === 2) {
      const pair = this.touchPair(), start = this.pinch;
      this.zoom = clamp(start.zoom * pair.distance / start.distance, 1, 3);
      const factor = this.zoom / start.zoom;
      this.pan.x = (pair.x - v.cx) / stageScale - factor * ((start.x - v.cx) / stageScale - start.pan.x);
      this.pan.y = (pair.y - v.cy) / stageScale - factor * ((start.y - v.cy) / stageScale - start.pan.y);
      this.applyView();
      return;
    }
    const drag = this.drag;
    const point = drag && this.touches.get(drag.pointerId);
    if (!point) return;
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (drag.kind === 'pending') {
      if (Math.hypot(dx, dy) < 3) return;
      if (drag.tray && (drag.id === null || (drag.pointerType === 'touch' && Math.abs(dx) > 1.6 * Math.abs(dy)))) drag.kind = 'scroll';
      else if (drag.id === null) drag.kind = 'pan';
      else {
        drag.kind = 'piece';
        this.drawGhost(drag.id);
      }
    }
    if (drag.kind === 'scroll' && drag.id !== null && (point.y < drag.trayTop || (dy < -12 && -dy > Math.abs(dx) * .65))) {
      drag.kind = 'piece';
      this.drawGhost(drag.id);
    }
    if (drag.kind === 'scroll') this.tray.scrollLeft = drag.scrollLeft - dx / stageScale;
    else if (drag.kind === 'pan') {
      this.pan = { x: drag.pan.x + dx / stageScale, y: drag.pan.y + dy / stageScale };
      this.applyView();
    } else {
      const p = this.boardPoint(point.x, point.y);
      this.positionGhost(p.x - drag.offset.x, p.y - drag.offset.y);
    }
  }

  drawGhost(id, group = this.model.groupIds(id), liftSource = true) {
    this.finishFlight();
    this.ghostId = id;
    const base = this.model.pieces[id];
    const members = group.map(member => this.model.pieces[member]);
    const left = Math.min(...members.map(p => p.col)) - base.col - .32;
    const top = Math.min(...members.map(p => p.row)) - base.row - .32;
    const width = Math.max(...members.map(p => p.col)) - base.col + 1.32 - left;
    const height = Math.max(...members.map(p => p.row)) - base.row + 1.32 - top;
    // Keep the moving SVG's raster surface just large enough for this group.
    const svg = this.float.ownerSVGElement, cell = this.view.cell * this.zoom;
    this.ghostOrigin = { x: left, y: top };
    svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
    svg.style.width = `${width * cell}px`;
    svg.style.height = `${height * cell}px`;
    this.float.replaceChildren(...members.map(p => {
      const source = p.x === null ? this.trayButtons.get(p.id) : this.stamps.get(p.id);
      if (liftSource) source?.classList.add('jb-lifted');
      const stamp = this.stamp(p, p.col - base.col, p.row - base.row);
      stamp.dataset.flightPiece = p.id;
      return stamp;
    }));
  }

  ghostTransform(x, y) {
    const v = this.view, cell = v.cell * this.zoom;
    const left = (v.cx - v.host.left) / v.scale + this.pan.x + (x + this.ghostOrigin.x - this.model.cols / 2) * cell;
    const top = (v.cy - v.host.top) / v.scale + this.pan.y + (y + this.ghostOrigin.y - this.model.rows / 2) * cell;
    return `translate3d(${left}px, ${top}px, 0)`;
  }

  positionGhost(x, y) {
    this.float.ownerSVGElement.style.transform = this.ghostTransform(x, y - LIFT);
  }

  pointerUp(e) {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelAnimationFrame(this.gestureFrame); this.gestureFrame = null;
    this.updateGesture();
    this.touches.delete(e.pointerId);
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
    if (this.pinch) {
      const [pointerId, start] = this.touches.entries().next().value;
      this.pinch = null;
      this.drag = { kind: 'pan', id: null, pointerId, start, pan: { ...this.pan } };
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === 'piece') {
      const point = this.boardPoint(e.clientX, e.clientY);
      const x = point.x - drag.offset.x, y = point.y - drag.offset.y;
      const from = { x, y: y - LIFT };
      this.clearDrag(true);
      if (this.hitWindow(e.clientX, e.clientY)) {
        this.drop(drag.id, x, y, from);
      } else if (drag.tray || (this.dock.getBoundingClientRect().top <= e.clientY && this.model.returnToTray(drag.id))) {
        if (!drag.tray) this.commit({ changed: true, joined: false, placed: 0 });
        this.animateReturn(drag.id);
      } else {
        this.animateLanding(drag.id, this.model.groupIds(drag.id), from);
      }
      return;
    }
    this.clearDrag();
    if (drag.kind === 'pending' && drag.id !== null) {
      this.selectPiece(drag.id);
    } else if (drag.kind === 'pending' && this.selection !== undefined && this.hitWindow(e.clientX, e.clientY)) {
      const point = this.boardPoint(e.clientX, e.clientY);
      this.drop(this.selection, point.x - .5, point.y - .5);
    }
  }

  clearDrag(keepGhost = false) {
    this.drag = null;
    if (!keepGhost && !this.flight) this.float.replaceChildren();
    this.host.querySelectorAll('.jb-lifted').forEach(el => el.classList.remove('jb-lifted'));
  }

  cancelDrag(keepFlight = false) {
    if (!keepFlight) this.finishFlight();
    cancelAnimationFrame(this.gestureFrame); this.gestureFrame = null;
    const ids = [...this.touches.keys()];
    this.touches.clear();
    for (const id of ids) {
      if (this.host.hasPointerCapture(id)) this.host.releasePointerCapture(id);
    }
    this.pinch = null;
    this.clearDrag();
    this.cancelKeyboard();
    this.selectPiece(undefined);
  }

  selectPiece(id) {
    this.host.querySelectorAll('.jb-selected').forEach(el => el.classList.remove('jb-selected'));
    this.selection = id;
    if (id !== undefined) this.host.querySelector(`[data-piece="${id}"]`)?.classList.add('jb-selected');
  }

  drop(id, x, y, from = this.pieceOrigin(id)) {
    const moving = this.model.groupIds(id);
    const action = this.model.drop(id, x, y);
    this.frontGroup = this.model.pieces[id].group;
    this.selectPiece(undefined);
    this.commit({ ...action, id }, moving, from);
  }

  pieceOrigin(id) {
    const stamp = this.stamps.get(id);
    if (stamp?.isConnected) return { x: Number(stamp.getAttribute('x')), y: Number(stamp.getAttribute('y')) };
    const center = this.trayPoint(id);
    const point = this.boardPoint(center.x, center.y);
    return { x: point.x - .5, y: point.y - .5 };
  }

  trayPoint(id) {
    const tray = this.tray.getBoundingClientRect(), button = this.trayButtons.get(id);
    const rect = button?.isConnected ? button.getBoundingClientRect() : tray;
    return { x: clamp(rect.left + rect.width / 2, tray.left, tray.right), y: tray.top + tray.height / 2 };
  }

  animateReturn(id) {
    const ghost = this.float.ownerSVGElement;
    const { host, scale } = this.view;
    const dest = this.trayPoint(id), button = this.trayButtons.get(id);
    const size = button?.offsetWidth || this.tray.clientHeight;
    const x = (dest.x - host.left) / scale - size / 2, y = (dest.y - host.top) / scale - size / 2;
    const factor = size / parseFloat(ghost.style.width);
    const rect = button?.isConnected && button.getBoundingClientRect();
    const tray = this.tray.getBoundingClientRect();
    const visible = rect && rect.left < tray.right && rect.right > tray.left;
    this.flyTo({ transform: `translate3d(${x}px, ${y}px, 0) scale(${factor})`, opacity: visible ? 1 : 0 },
      button ? [button] : [], 'jb-return');
  }

  animateLanding(id, members, from) {
    const p = this.model.pieces[id];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.float.replaceChildren();
      return 0;
    }
    // Touch and keyboard drops retain the already-rasterized, group-sized drag layer.
    // Tap-to-place and hints create that same layer at their source position.
    if (this.ghostId !== id || !this.float.firstElementChild) {
      this.drawGhost(id, members, false);
      this.float.ownerSVGElement.style.transform = this.ghostTransform(from.x, from.y);
    }
    const destinations = members.map(member => this.stamps.get(member)).filter(node => node?.isConnected);
    this.flyTo({ transform: this.ghostTransform(p.x, p.y), opacity: 1 }, destinations, 'jb-landing', !p.locked);
    return LAND_MS;
  }

  flyTo(end, destinations, kind, regrabbable = false) {
    const ghost = this.float.ownerSVGElement;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.float.replaceChildren();
      return;
    }
    for (const node of destinations) node.classList.add('jb-arriving');
    ghost.classList.add(kind);
    ghost.classList.toggle('jb-regrabbable', regrabbable);
    const animation = ghost.animate([{ transform: ghost.style.transform, opacity: 1 }, end],
      { duration: LAND_MS, easing: 'cubic-bezier(.2,.7,.28,1)', fill: 'forwards' });
    this.flight = { animation, destinations };
    animation.onfinish = () => this.finishFlight();
  }

  finishFlight() {
    if (!this.flight) return;
    const { animation, destinations } = this.flight;
    this.flight = null;
    animation.onfinish = null;
    animation.cancel();
    if (!this.model.solved) for (const node of destinations) node.classList.remove('jb-arriving');
    this.float.ownerSVGElement.classList.remove('jb-landing', 'jb-return', 'jb-regrabbable');
    this.float.replaceChildren();
  }

  flash(id) {
    const center = this.model.pieces[id];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const radius = reduced ? .85 : 2.5;
    const near = this.model.pieces.filter(p => p.group === center.group
      && Math.abs(p.x - center.x) <= radius + .8 && Math.abs(p.y - center.y) <= radius + .8);
    this.sheenClip.replaceChildren(...near.map(p => svgNode('use', {
      href: `#${this.prefix}outline-${p.id}`, x: p.x, y: p.y,
    })));
    const origin = svgNode('g', { transform: `translate(${center.x + .5} ${center.y + .5})` });
    const light = svgNode('circle', { r: radius, fill: `url(#${this.prefix}sheen-light)` });
    origin.append(light);
    this.sheen.replaceChildren(origin);
    const timing = { duration: MERGE_FLASH_DURATION };
    if (!reduced) light.animate([{ transform: 'scale(.08)' }, { transform: 'scale(1)' }], timing);
    const envelope = origin.animate([{ opacity: 0 }, { offset: .32, opacity: reduced ? .45 : 1 }, { opacity: 0 }], timing);
    envelope.onfinish = () => origin.remove();
  }

  commit(action, moving = [action.id], from = action.id == null ? null : this.pieceOrigin(action.id)) {
    // At victory the original photo takes over from the old static board as the
    // final group lands. Building its final SVG stamps only to hide them wastes a repaint.
    if (action.changed) this.render({ updatePieces: !this.model.solved });
    const delay = from ? this.animateLanding(action.id, moving, from) : 0;
    if (!action.changed) return;
    clearTimeout(this.feedbackTimer);
    this.sheen.replaceChildren();
    this.onChange?.(this.model.serialize(), action);
    if (action.placed || action.joined) {
      const landed = () => {
        this.flash(action.id);
        if (this.model.solved) this.onWin?.();
      };
      if (delay) this.feedbackTimer = setTimeout(landed, delay);
      else landed();
    }
  }

  cancelKeyboard() {
    if (!this.keyboard) return;
    this.keyboard = null;
    this.clearDrag();
  }

  keyDown(e) {
    if (this.blocked) return;
    if (this.previewing) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        this.closePreview();
      }
      return;
    }
    const pieceNode = e.target.closest('[data-piece]');
    if (!this.keyboard && pieceNode && [' ', 'Enter'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const id = Number(pieceNode.dataset.piece), p = this.model.pieces[id];
      this.keyboard = { id, x: p.x ?? 0, y: p.y ?? 0 };
      this.drawGhost(id);
      this.positionGhost(this.keyboard.x, this.keyboard.y);
      this.win.focus({ preventScroll: true });
      return;
    }
    if (!this.keyboard) return;
    const pos = this.keyboard;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[e.key] && ![' ', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (directions[e.key]) {
      const [dx, dy] = directions[e.key];
      pos.x = clamp(Math.round(pos.x + dx), 0, this.model.cols - 1);
      pos.y = clamp(Math.round(pos.y + dy), 0, this.model.rows - 1);
      this.positionGhost(pos.x, pos.y);
    } else {
      this.keyboard = null;
      this.clearDrag(e.key !== 'Escape');
      if (e.key !== 'Escape') this.drop(pos.id, pos.x, pos.y, { x: pos.x, y: pos.y - LIFT });
      const focus = this.host.querySelector(`[data-piece="${pos.id}"]`) ?? this.tray.firstElementChild;
      focus?.focus({ preventScroll: true });
    }
  }

  wheel(e) {
    if (this.blocked || this.previewing || !this.view || this.drag || this.pinch) return;
    if (this.tray.contains(e.target)) {
      e.preventDefault();
      this.tray.scrollLeft += (e.deltaX || e.deltaY) / this.view.scale;
    } else if (this.win.contains(e.target)) {
      e.preventDefault();
      this.setZoom(clamp(this.zoom * Math.exp(-e.deltaY * .002), 1, 3), e.clientX, e.clientY);
    }
  }

  setPreview(visible) {
    this.cancelDrag();
    this.previewing = visible;
    this.host.classList.toggle('jb-preview', visible);
    this.win.inert = visible;
    this.dock.hidden = visible;
    this.onPreviewChange?.();
  }

  closePreview() {
    if (!this.previewing) return false;
    this.setPreview(false);
    return true;
  }

  placeHint() {
    if (this.blocked || this.previewing || this.model.solved) return;
    this.cancelDrag();
    const action = this.model.placeHint();
    if (action.changed) this.commit({ ...action, hint: true });
  }

  toolClick(button) {
    if (!button.dataset.tool || button.disabled || this.blocked) return;
    this.cancelDrag();
    switch (button.dataset.tool) {
      case 'edge':
        this.edgesOnly = !this.edgesOnly;
        button.setAttribute('aria-pressed', String(this.edgesOnly));
        this.tray.scrollLeft = 0;
        this.render();
        break;
      case 'prev':
      case 'next':
        this.tray.scrollBy({ left: (button.dataset.tool === 'prev' ? -1 : 1) * this.tray.clientWidth * .85, behavior: 'smooth' });
        break;
    }
  }

  setBlocked(blocked) {
    if (blocked) this.cancelDrag(this.model.solved);
    this.blocked = Boolean(blocked);
    this.host.inert = this.blocked;
  }

  celebrate() {
    this.host.classList.add('jb-solved');
    this.pan = { x: 0, y: 0 };
    this.setZoom(1);
    this.confetti.start();
  }

  destroy() {
    this.confetti.destroy();
    clearTimeout(this.feedbackTimer);
    this.cancelDrag();
    this.events.abort();
    this.host.inert = false;
    this.host.classList.remove('jb-workspace', 'jb-preview', 'jb-zoomed', 'jb-solved');
    this.host.replaceChildren();
  }
}
