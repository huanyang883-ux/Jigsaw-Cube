import * as THREE from 'three';

export const CARD_RADIUS = .042;
// Leave room for three standard deviations of the lifted shadow's penumbra.
export const SHADOW_REACH = .15;

export function cardShapeUniforms() {
  return {
    uCardBounds: { value: new THREE.Vector4(-.489, -.489, .489, .489) },
    uCardEdges: { value: new THREE.Vector4(1, 1, 1, 1) }, // left, right, bottom, top
    uCardRadius: { value: CARD_RADIUS },
    uCardCell: { value: new THREE.Vector2(1, 1) },
    uCardConcave: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uCardDiagonals: { value: new THREE.Vector4() },
  };
}

export function updateCardShape(uniforms, bounds) {
  const { left, right, bottom, top, joins } = bounds;
  uniforms.uCardBounds.value.set(left, bottom, right, top);
  uniforms.uCardEdges.value.set(+!joins.left, +!joins.right, +!joins.bottom, +!joins.top);
  uniforms.uCardRadius.value = Math.min(CARD_RADIUS, (right - left) * .15, (top - bottom) * .15);
  const height = bounds.height ?? (top - bottom) / .978;
  uniforms.uCardCell.value.set(1, height);
  const innerRadius = CARD_RADIUS * (2 / 3) * Math.min(1, height);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy], i) => {
    const [mx, my] = bounds.corners?.[i] ?? [0, 0];
    uniforms.uCardConcave.value[i].set(sx * .5 + mx * (innerRadius - .011), sy * .5 * height + my * (innerRadius - .011 * height), mx, my);
  });
  uniforms.uCardDiagonals.value.fromArray((bounds.diagonals ?? [false, false, false, false]).map(Number));
}

// Positive inside. Joined edges are omitted, so both the rim and shadow follow
// the connected photo's outside contour, never its internal tile boundaries.
export const cardShapeGLSL = `
  uniform vec4 uCardBounds, uCardEdges;
  uniform float uCardRadius;
  uniform vec2 uCardCell;
  uniform vec4 uCardConcave[4];
  uniform vec4 uCardDiagonals;
  float cardDistance(vec2 p) {
    vec2 lo = uCardBounds.xy, hi = uCardBounds.zw;
    float r = uCardRadius, d = 100.0;
    if (uCardEdges.x > 0.5) d = min(d, p.x - lo.x);
    if (uCardEdges.y > 0.5) d = min(d, hi.x - p.x);
    if (uCardEdges.z > 0.5) d = min(d, p.y - lo.y);
    if (uCardEdges.w > 0.5) d = min(d, hi.y - p.y);
    vec2 q = p - (lo + r);
    if (uCardEdges.x * uCardEdges.z > 0.5 && q.x < 0.0 && q.y < 0.0) d = min(d, r - length(q));
    q = p - vec2(hi.x - r, lo.y + r);
    if (uCardEdges.y * uCardEdges.z > 0.5 && q.x > 0.0 && q.y < 0.0) d = min(d, r - length(q));
    q = p - vec2(lo.x + r, hi.y - r);
    if (uCardEdges.x * uCardEdges.w > 0.5 && q.x < 0.0 && q.y > 0.0) d = min(d, r - length(q));
    q = p - (hi - r);
    if (uCardEdges.y * uCardEdges.w > 0.5 && q.x > 0.0 && q.y > 0.0) d = min(d, r - length(q));
    float innerRadius = ${CARD_RADIUS * (2 / 3)} * min(1.0, uCardCell.y);
    for (int i = 0; i < 4; i++) {
      vec4 corner = uCardConcave[i];
      vec2 vertex = corner.xy - corner.zw * (innerRadius - 0.011 * uCardCell);
      // Restrict each notch to its corner. Its infinite edge continuations
      // must not clip the rounded end of another notch on the same card.
      vec2 reach = vec2(innerRadius + ${SHADOW_REACH}) + 0.011 * uCardCell;
      if (abs(corner.z) > 0.5 && all(lessThan(abs(p - vertex), reach))) {
        q = (p - corner.xy) * corner.zw;
        d = length(min(q, 0.0)) - max(min(q.x, q.y), 0.0) - innerRadius;
      }
    }
    // Deep interior distances carry no visible edge information. Capping
    // them also keeps derivative antialiasing continuous at a notch's range.
    return min(d, 0.05);
  }
`;

function shapeMaterial(material, shape, fragment, extra = {}, declarations = '') {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shape, extra);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCardPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCardPoint = position.xy;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vCardPoint;\n${cardShapeGLSL}\n${declarations}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment}`);
  };
  material.customProgramCacheKey = () => fragment;
  return material;
}

export function createCardFaceMaterial(map, shape) {
  return shapeMaterial(new THREE.MeshBasicMaterial({ map, transparent: true }), shape, `
    float edgeDistance = cardDistance(vCardPoint);
    float aa = max(fwidth(edgeDistance) * 0.65, 0.0001);
    if (edgeDistance < -aa) discard;
    diffuseColor.a *= smoothstep(-aa, aa, edgeDistance);
    vec2 normal = -vec2(dFdx(edgeDistance), dFdy(edgeDistance));
    normal /= max(length(normal), 0.0001);
    float light = clamp(0.65 + dot(normal, vec2(-0.6, 0.8)) * 0.35, 0.0, 1.0);
    float rim = 1.0 - smoothstep(0.009, 0.015, edgeDistance);
    vec3 ivory = mix(vec3(0.70, 0.68, 0.62), vec3(1.0, 0.985, 0.95), light);
    diffuseColor.rgb = mix(diffuseColor.rgb, ivory, rim * 0.96);
    float hairline = 1.0 - smoothstep(0.001, 0.0035, edgeDistance);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.17, 0.14), hairline * 0.48);
  `);
}

export function createCardShadowMaterial(shape) {
  const material = new THREE.MeshBasicMaterial({ color: 0x484336, transparent: true, depthWrite: false });
  const plane = new THREE.Vector3();
  material.userData.shadowPlane = plane;
  return shapeMaterial(material, shape, `
    // Two arms of an L share the shadow in its notch. Give each fragment to
    // the nearer tile so their translucent shadows cannot double-darken it.
    for (int i = 0; i < 4; i++) {
      vec2 offset = vec2((i == 0 || i == 2) ? -1.0 : 1.0, i < 2 ? -uCardCell.y : uCardCell.y);
      float bisector = dot(vCardPoint, offset) - dot(offset, offset) * 0.5;
      if (uCardDiagonals[i] > 0.5 && (offset.x > 0.0 ? bisector >= 0.0 : bisector > 0.0)) discard;
    }
    float outside = max(-cardDistance(vCardPoint), 0.0);
    vec2 pointOnTile = clamp(vCardPoint / uCardCell, vec2(-0.5), vec2(0.5));
    float height = max(0.0, uShadowPlane.x + dot(pointOnTile, uShadowPlane.yz));
    float lift = smoothstep(0.0, 0.45, height);
    float blur = mix(0.024, 0.05, lift);
    float density = mix(0.12, 0.32, smoothstep(0.0, 0.10, height)) * (1.0 - 0.27 * lift);
    diffuseColor.a *= density * exp(-0.5 * outside * outside / (blur * blur));
    if (diffuseColor.a < 0.001) discard;
  `, { uShadowPlane: { value: plane } }, 'uniform vec3 uShadowPlane;');
}

// Slopes measure z change per local unit. Store the rise across each whole tile
// so the shader can sample height at either edge, including on portrait boards.
export function updateCardShadow(material, height, slopeX = 0, slopeY = 0, cellHeight = 1) {
  material.userData.shadowPlane.set(height, slopeX, slopeY * cellHeight);
}

export function createCardBodyGeometry(height) {
  const x = .489, y = .489 * height, r = Math.min(CARD_RADIUS, y * .3), shape = new THREE.Shape();
  shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y); shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r); shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y); shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r); shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .048, bevelEnabled: true, bevelSize: .003, bevelThickness: .003, bevelSegments: 2, steps: 1, curveSegments: 6 });
  geometry.translate(0, 0, -.024);
  const normals = geometry.attributes.normal, colors = new Float32Array(normals.count * 3);
  // Warm cut edges and a lighter bevel are baked once into the shared body.
  for (let i = 0; i < normals.count; i++) {
    const face = Math.abs(normals.getZ(i));
    const light = .63 + .22 * face + .15 * (-.60 * normals.getX(i) + .80 * normals.getY(i));
    colors.set([light, light * (.90 + .08 * face), light * (.76 + .20 * face)], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
