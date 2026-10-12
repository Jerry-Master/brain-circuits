import * as THREE from 'three';

// Default opacity per manifest group; the GUI edits these live.
export const GROUP_OPACITY = {
  shell: 0.1,
  cortex: 0.45,
  context: 0.18,
  striatum: 0.9,
  pallidum: 0.92,
  stn: 0.95,
  nigra: 0.9,
  thalamus: 0.92,
};

// Draw order: opaque-ish nuclei first, then translucent cortex/context, glass shell last.
const RENDER_ORDER = { striatum: 1, pallidum: 1, stn: 1, nigra: 1, thalamus: 1, cortex: 2, context: 3, shell: 4 };

/** Fresnel "glass" material for the whole-brain shell: rim bright, face-on nearly invisible. */
export function makeShellMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: GROUP_OPACITY.shell },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float a = uOpacity * (0.25 + 2.4 * f);
        gl_FragColor = vec4(uColor * (0.35 + 0.8 * f), clamp(a, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/** Lit material whose emissive glow encodes activation (see applyActivation). */
export function makeStructureMaterial(meta) {
  const translucent = meta.group === 'cortex' || meta.group === 'context';
  const mat = new THREE.MeshStandardMaterial({
    color: meta.color,
    roughness: 0.55,
    metalness: 0.05,
    transparent: true,
    opacity: GROUP_OPACITY[meta.group] ?? 1,
    depthWrite: !translucent,
    side: translucent ? THREE.DoubleSide : THREE.FrontSide,
    emissive: new THREE.Color(meta.color),
    emissiveIntensity: 0,
  });
  mat.userData.baseColor = new THREE.Color(meta.color);
  return mat;
}

export function renderOrderFor(group) {
  return RENDER_ORDER[group] ?? 1;
}

const INHIBITED = new THREE.Color('#1d2a52');

/**
 * level > 0: excited (emissive glow, bloom picks it up)
 * level < 0: inhibited (darkened, shifted toward blue)
 * tonic: baseline glow for tonically active nuclei (GPe/GPi)
 */
export function applyActivation(mat, level, tonic, pulse) {
  const base = mat.userData.baseColor;
  if (level >= 0) {
    mat.color.copy(base);
    mat.emissiveIntensity = tonic * 0.35 + level * (1.6 + 0.6 * pulse);
  } else {
    mat.color.copy(base).lerp(INHIBITED, Math.min(1, -level) * 0.75);
    mat.emissiveIntensity = tonic * 0.35 * (1 + level);
  }
}
