import * as THREE from 'three';
import { cardShapeUniforms, cardShapeGLSL } from './card-surface.js';

export const MERGE_FLASH_DURATION = 600;
const smooth = (t) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
// A soft rise followed by a longer tail, with no second pulse.
export const mergeFlashEnvelope = (t) => t < .32 ? smooth(t / .32) : 1 - smooth((t - .32) / .68);

export function createMergeFlashMaterial(reducedMotion, shape = cardShapeUniforms()) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
    uniforms: {
      ...shape,
      uStrength: { value: 0 }, uPhase: { value: 0 }, uSweep: { value: reducedMotion ? 0 : 1 },
      uMin: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: `
      varying vec2 vPhotoUv;
      varying vec2 vCardPoint;
      void main() {
        vPhotoUv = uv;
        vCardPoint = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uStrength, uPhase, uSweep;
      uniform vec2 uMin, uSize;
      varying vec2 vPhotoUv;
      varying vec2 vCardPoint;
      ${cardShapeGLSL}
      void main() {
        // All joined pieces use the same photo-UV bounds, so the light crosses
        // the complete group once instead of restarting at every tile edge.
        vec2 p = (vPhotoUv - uMin) / uSize;
        float diagonal = (p.x + 1.0 - p.y) * 0.5;
        float center = mix(-0.25, 1.25, uPhase);
        float distance = (diagonal - center) / 0.22;
        float sheen = exp(-distance * distance);
        float alpha = uStrength * mix(1.0, 0.38 + 0.62 * sheen, uSweep);
        float edgeDistance = cardDistance(vCardPoint);
        float aa = max(fwidth(edgeDistance) * 0.65, 0.0001);
        alpha *= smoothstep(-aa, aa, edgeDistance);
        gl_FragColor = vec4(1.0, 0.985, 0.95, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}
