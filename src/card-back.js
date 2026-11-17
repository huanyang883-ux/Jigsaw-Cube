import * as THREE from 'three';
import { THEME_ART } from './theme-art.js';

function drawCandy(c, art) {
  c.translate(0, -1); c.rotate(-.35);
  c.fillStyle = art.fill; c.beginPath(); c.roundRect(-66, -57, 132, 114, 44); c.fill(); c.stroke();
  c.fillStyle = art.wrapper;
  for (const sign of [-1, 1]) {
    c.beginPath(); c.moveTo(sign * 66, 0); c.lineTo(sign * 108, -48);
    c.quadraticCurveTo(sign * 130, 0, sign * 108, 48); c.closePath(); c.fill(); c.stroke();
  }
  c.strokeStyle = art.highlight; c.lineWidth = 11;
  c.beginPath(); c.moveTo(-25, -35); c.quadraticCurveTo(-52, 0, -25, 35); c.stroke();
}

function drawPaw(c, art) {
  c.scale(9.6, 9.6); c.translate(-12, -12);
  c.lineWidth = 1; c.fillStyle = art.fill;
  for (const [x, y, rx, ry, angle] of [[5, 8, 2.1, 3, -.42], [10, 5, 2.1, 3, 0], [15.5, 5.5, 2.1, 3, 0], [20, 9, 2, 2.8, .42]]) {
    c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  const pad = new Path2D('M7 14c2-5 6-5 9 0 5 4 2 8-2 6-2-1-3-1-5 0-5 2-7-3-2-6Z');
  c.fill(pad); c.stroke(pad);
}

function drawCube(c, art) {
  c.scale(10, 10); c.translate(-12, -12); c.lineWidth = 1.1;
  for (const [path, fill] of [
    ['M12 2 21 7 12 12 3 7Z', art.highlight],
    ['M3 7 12 12v10l-9-5Z', art.wrapper],
    ['M12 12 21 7v10l-9 5Z', art.fill],
  ]) {
    const face = new Path2D(path); c.fillStyle = fill; c.fill(face); c.stroke(face);
  }
  c.lineWidth = .85;
  c.stroke(new Path2D('M8 4l9 5v10M7 19V9l9-5M3 12l9 5 9-5'));
}

function drawGlobe(c, art) {
  c.scale(10, 10); c.translate(-12, -12); c.lineWidth = 1.1;
  c.fillStyle = art.fill; c.beginPath(); c.arc(12, 12, 10, 0, Math.PI * 2); c.fill(); c.stroke();
  c.save(); c.clip(); c.fillStyle = art.wrapper;
  for (const d of ['M5 4 8 5 9 8 7 10 4 9 2 12 1 5Z', 'M22 10 18 8 15 9 14 12 17 14 18 19 23 18Z', 'M8 13 12 14 13 17 10 21 8 17Z']) {
    const land = new Path2D(d); c.fill(land); c.stroke(land);
  }
  c.restore();
}

// Each theme shares its emblem and palette across cube stickers and puzzle cards.
// Portrait cards extend the frame while keeping the emblem at its natural ratio.
export function createBackTexture(aspect = 1, theme = 0) {
  const art = THEME_ART[theme];
  const canvas = document.createElement('canvas');
  const width = 512, height = Math.round(width / aspect);
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d');
  c.fillStyle = art.base; c.fillRect(0, 0, width, height);
  c.strokeStyle = art.stripe; c.lineWidth = 2;
  for (let i = -height; i < width; i += 44) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + height, height); c.stroke();
  }
  c.fillStyle = art.panel; c.beginPath(); c.roundRect(33, 33, width - 66, height - 66, 60); c.fill();
  c.strokeStyle = art.border; c.lineWidth = 4; c.stroke();
  c.save(); c.translate(width / 2, height / 2);
  c.scale(Math.min(1, 1 / aspect), Math.min(1, 1 / aspect));
  c.fillStyle = art.medallion; c.beginPath(); c.arc(0, 0, 132, 0, Math.PI * 2); c.fill();
  c.strokeStyle = art.ink; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
  if (art.icon === 'paw') drawPaw(c, art);
  else if (art.icon === 'globe') drawGlobe(c, art);
  else if (art.icon === 'cube') drawCube(c, art);
  else drawCandy(c, art);
  c.restore();
  c.fillStyle = art.dots;
  for (const [x, y] of [[95, 91], [width - 96, 89], [94, height - 96], [width - 94, height - 94]]) {
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
