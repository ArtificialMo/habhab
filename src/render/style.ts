import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Rendering/outlineRenderer";

/**
 * Palette, lifted from the art-direction reference (§2.15): warm stone, cypress
 * green, saturated Mediterranean blue, terracotta. Kept in one place so the whole
 * scene can be re-graded at once.
 */
export const PALETTE = {
  stone: new Color3(0.91, 0.85, 0.72),
  stoneShadow: new Color3(0.72, 0.65, 0.53),
  cliff: new Color3(0.82, 0.77, 0.68),
  cliffDark: new Color3(0.6, 0.56, 0.5),
  grass: new Color3(0.35, 0.62, 0.24),
  cypress: new Color3(0.16, 0.42, 0.19),
  cypressLight: new Color3(0.25, 0.55, 0.26),
  sea: new Color3(0.07, 0.45, 0.85),
  seaDeep: new Color3(0.03, 0.28, 0.62),
  seaFoam: new Color3(0.85, 0.95, 1.0),
  sky: new Color3(0.35, 0.72, 0.98),
  terracotta: new Color3(0.86, 0.35, 0.2),
  cream: new Color3(0.97, 0.94, 0.87),
  shutterGreen: new Color3(0.13, 0.36, 0.24),
  flower: new Color3(0.95, 0.35, 0.55),
  playerYellow: new Color3(1.0, 0.79, 0.09),
  playerYellowDark: new Color3(0.85, 0.55, 0.05),
  glass: new Color3(0.55, 0.78, 0.9),
  tyre: new Color3(0.13, 0.13, 0.15),
  chrome: new Color3(0.78, 0.8, 0.84),
  headlight: new Color3(1.0, 0.98, 0.86),
  outline: new Color3(0.06, 0.05, 0.09),
} as const;

/** Enemy strength gradient (§2.12): white → pale pink → red → dark red → black. */
/**
 * Enemies are black. The tier gradient now rides on how dark they are rather than
 * on hue, so the red gas tank at the rear is the only warm thing on the car and
 * reads instantly as the place to hit.
 */
export const ENEMY_TIERS: Color3[] = [
  new Color3(0.26, 0.26, 0.3),
  new Color3(0.21, 0.21, 0.25),
  new Color3(0.16, 0.16, 0.19),
  new Color3(0.11, 0.11, 0.14),
  new Color3(0.06, 0.06, 0.08),
];

/** The weak point bolted to every enemy's tail. */
export const GAS_TANK_COLOUR = new Color3(0.92, 0.16, 0.12);

const CEL_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float waveAmp;
uniform float waveTime;
varying vec3 vNormalW;
varying vec3 vPositionW;
varying float vWave;

void main(void) {
  vec3 p = position;
  vec3 n = normal;
  vWave = 0.0;

  // Water. Three crossing sine trains at different angles, scales and speeds, so
  // the surface never resolves into a visible repeating grid. The normal is
  // rebuilt analytically from the wave derivatives, which is what lets the cel
  // bands break across the swell instead of shading it as a flat plate.
  if (waveAmp > 0.0) {
    vec4 wp0 = world * vec4(position, 1.0);
    float x = wp0.x;
    float z = wp0.z;

    float w1 = sin(x * 0.085 + waveTime * 0.9);
    float w2 = sin(z * 0.062 - waveTime * 0.7 + 1.3);
    float w3 = sin((x * 0.041 + z * 0.053) + waveTime * 1.35);
    float h = (w1 * 0.5 + w2 * 0.35 + w3 * 0.28) * waveAmp;

    float dhdx = (cos(x * 0.085 + waveTime * 0.9) * 0.085 * 0.5
                + cos((x * 0.041 + z * 0.053) + waveTime * 1.35) * 0.041 * 0.28) * waveAmp;
    float dhdz = (cos(z * 0.062 - waveTime * 0.7 + 1.3) * 0.062 * 0.35
                + cos((x * 0.041 + z * 0.053) + waveTime * 1.35) * 0.053 * 0.28) * waveAmp;

    p.y += h;
    n = normalize(vec3(-dhdx, 1.0, -dhdz));
    vWave = h / max(waveAmp, 0.0001);
  }

  vec4 worldPos = world * vec4(p, 1.0);
  vPositionW = worldPos.xyz;
  vNormalW = waveAmp > 0.0 ? normalize(n) : normalize(mat3(world) * n);
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

/**
 * Two hard bands plus a soft third, a warm bounce term from below, and a rim light.
 * The bands are what make it read as drawn rather than rendered; the rim is what
 * keeps a dark car from disappearing against a dark sea.
 */
const CEL_FRAGMENT = `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPositionW;
varying float vWave;
uniform vec3 lightDir;
uniform vec3 baseColor;
uniform vec3 shadeColor;
uniform vec3 rimColor;
uniform vec3 cameraPosition;
uniform float rimPower;
uniform float rimStrength;
uniform float flash;
uniform float bandSoftness;
uniform float groundBlend;
uniform float groundRadius;
uniform vec3 groundRimTint;
uniform float waveAmp;
uniform float waveTime;
void main(void) {
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(-lightDir);
  float ndl = dot(N, L);

  float lit  = smoothstep(0.02 - bandSoftness, 0.02 + bandSoftness, ndl);
  float hot  = smoothstep(0.55 - bandSoftness, 0.55 + bandSoftness, ndl);

  vec3 color = mix(shadeColor, baseColor, lit);
  color = mix(color, baseColor * 1.14, hot * 0.65);

  // Warm bounce from the stone below keeps undersides from going flat black.
  float bounce = clamp(-N.y, 0.0, 1.0);
  color += shadeColor * bounce * 0.16;

  vec3 V = normalize(cameraPosition - vPositionW);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  float rim = pow(1.0 - facing, rimPower);
  color += rimColor * rim * rimStrength;

  // A hard specular cap and a cool contour lift sell painted, cel-shaded material
  // better than a smooth PBR highlight: the car flashes like an illustration, but
  // the light direction and grazing angle still describe a real rounded body.
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 28.0);
  float specBand = smoothstep(0.42, 0.62, spec);
  color = mix(color, mix(baseColor, vec3(1.0), 0.78), specBand * 0.22);
  float contourBand = smoothstep(0.72, 0.98, 1.0 - facing);
  color += shadeColor * contourBand * 0.055;
  float cavity = 1.0 - smoothstep(0.0, 0.72, abs(N.y));
  color *= 1.0 - cavity * 0.045;

  // Large flat surfaces (the deck, the sea) carry no shading information from a
  // single directional light — every pixel gets the same N·L and the whole thing
  // reads as a dead void. This adds the large-scale variation a real surface has:
  // a warm, brighter centre falling to a cooler rim, plus low-frequency mottling so
  // no two square metres are the same value.
  if (groundBlend > 0.0) {
    float rr = clamp(length(vPositionW.xz) / groundRadius, 0.0, 1.4);
    float falloff = smoothstep(0.15, 1.05, rr) * groundBlend;
    color = mix(color, color * groundRimTint, falloff);
    float mottle =
      sin(vPositionW.x * 0.21) * sin(vPositionW.z * 0.17) * 0.5 +
      sin(vPositionW.x * 0.07 + 1.7) * sin(vPositionW.z * 0.061 - 0.9) * 0.5;
    color *= 1.0 + mottle * 0.055 * groundBlend;
  }

  // Wave crests catch the sun as hard white caps — the single cue that reads as
  // moving water rather than as a tilted blue plane.
  if (waveAmp > 0.0) {
    float crest = smoothstep(0.62, 0.95, vWave);
    color = mix(color, vec3(0.93, 0.98, 1.0), crest * 0.55);
    float trough = smoothstep(0.55, 1.0, -vWave);
    color *= 1.0 - trough * 0.22;
  }

  color = mix(color, vec3(1.0), clamp(flash, 0.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

let registered = false;

function register(): void {
  if (registered) return;
  Effect.ShadersStore["carboyCelVertexShader"] = CEL_VERTEX;
  Effect.ShadersStore["carboyCelFragmentShader"] = CEL_FRAGMENT;
  registered = true;
}

export interface CelOptions {
  shade?: Color3;
  rim?: Color3;
  rimStrength?: number;
  rimPower?: number;
  /** 0 = razor-sharp bands, higher = softer. Terrain wants softer than vehicles. */
  softness?: number;
  /** Enables the large-scale ground gradient. 0..1 strength. */
  ground?: number;
  /** Radius over which the ground gradient falls off. */
  groundRadius?: number;
  /** Colour the surface is tinted toward at the rim. */
  groundRimTint?: Color3;
  /** Vertical wave amplitude, metres. Non-zero turns the surface into water. */
  waveAmp?: number;
}

/** Scene-wide sun direction. Warm, high, raking from the left (§2.15). */
export const SUN_DIRECTION = new Vector3(-0.45, -0.82, 0.36).normalize();

export function celMaterial(
  name: string,
  scene: Scene,
  base: Color3,
  opts: CelOptions = {}
): ShaderMaterial {
  register();
  const mat = new ShaderMaterial(
    name,
    scene,
    { vertex: "carboyCel", fragment: "carboyCel" },
    {
      attributes: ["position", "normal"],
      uniforms: [
        "world",
        "worldViewProjection",
        "cameraPosition",
        "lightDir",
        "baseColor",
        "shadeColor",
        "rimColor",
        "rimPower",
        "rimStrength",
        "flash",
        "bandSoftness",
        "groundBlend",
        "groundRadius",
        "groundRimTint",
        "waveAmp",
        "waveTime",
      ],
    }
  );
  // Shade tone is the base pushed toward a cool blue rather than toward black —
  // neutral-darkened shadows are what make stylised work look muddy.
  const shade = opts.shade ?? base.scale(0.52).add(new Color3(0.06, 0.07, 0.16));
  mat.setVector3("lightDir", SUN_DIRECTION);
  mat.setColor3("baseColor", base);
  mat.setColor3("shadeColor", shade);
  mat.setColor3("rimColor", opts.rim ?? new Color3(1.0, 0.93, 0.75));
  mat.setFloat("rimPower", opts.rimPower ?? 3.2);
  mat.setFloat("rimStrength", opts.rimStrength ?? 0.32);
  mat.setFloat("flash", 0);
  mat.setFloat("bandSoftness", opts.softness ?? 0.035);
  mat.setFloat("groundBlend", opts.ground ?? 0);
  mat.setFloat("groundRadius", opts.groundRadius ?? 20);
  mat.setColor3("groundRimTint", opts.groundRimTint ?? new Color3(0.72, 0.7, 0.82));
  mat.setFloat("waveAmp", opts.waveAmp ?? 0);
  mat.setFloat("waveTime", 0);
  mat.backFaceCulling = true;
  return mat;
}

/**
 * Bold graphic outline (§2.15). Babylon extrudes back faces, so width is in world
 * units — gameplay objects get a heavier line than scenery so they pop out of it.
 */
export function outline(mesh: Mesh, width = 0.035, color: Color3 = PALETTE.outline): void {
  mesh.renderOutline = true;
  mesh.outlineWidth = width;
  mesh.outlineColor = color;
}

export function toColor4(c: Color3, a = 1): Color4 {
  return new Color4(c.r, c.g, c.b, a);
}
