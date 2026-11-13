import * as THREE from 'three';

// Shared by cube stickers and puzzle cards. Portrait cards keep the emblem round.
export function createBackTexture(aspect = 1) {
  const canvas = document.createElement('canvas');
  const width = 512, height = Math.round(width / aspect);
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff4df'; c.fillRect(0, 0, width, height);
  c.strokeStyle = '#ecd9be'; c.lineWidth = 2;
  for (let i = -height; i < width; i += 44) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + height, height); c.stroke();
  }
  c.fillStyle = '#fae7cf'; c.beginPath(); c.roundRect(33, 33, width - 66, height - 66, 60); c.fill();
  c.strokeStyle = '#e7ccb5'; c.lineWidth = 4; c.stroke();
  c.save(); c.translate(width / 2, height / 2);
  c.scale(Math.min(1, 1 / aspect), Math.min(1, 1 / aspect));
  c.fillStyle = '#fff9eb'; c.beginPath(); c.arc(0, 0, 132, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#d4a58f'; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
  c.translate(0, -1); c.rotate(-.35);
  c.fillStyle = '#efb4a4'; c.beginPath(); c.roundRect(-66, -57, 132, 114, 44); c.fill(); c.stroke();
  c.fillStyle = '#f4ccb6';
  for (const sign of [-1, 1]) {
    c.beginPath(); c.moveTo(sign * 66, 0); c.lineTo(sign * 108, -48);
    c.quadraticCurveTo(sign * 130, 0, sign * 108, 48); c.closePath(); c.fill(); c.stroke();
  }
  c.strokeStyle = '#fff1df'; c.lineWidth = 11;
  c.beginPath(); c.moveTo(-25, -35); c.quadraticCurveTo(-52, 0, -25, 35); c.stroke(); c.restore();
  c.fillStyle = '#dcbca1';
  for (const [x, y] of [[95, 91], [width - 96, 89], [94, height - 96], [width - 94, height - 94]]) {
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
