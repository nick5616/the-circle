import { useEffect, useRef } from "react";
import { scene } from "../scene";
import { audioLevels } from "../audio";
import { hexToRgb } from "../fireColors";

// The campfire. One full-viewport WebGL pass draws:
//   - the fire itself, with one coloured tongue per person (flame-test
//     chemistry: everyone burns as their element) that rises when they talk
//   - flames licking up around each video tile, in that person's colour
//   - embers drifting up, warm light pooling on the ground, a candle-glow
//     following the cursor
// Rendered at reduced resolution (flames are soft) with an adaptive scale.

const MAX = 8;

const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform vec3 uFire;
uniform float uFireAlpha;
uniform float uHeat;
uniform int uN;
uniform vec4 uRect[${MAX}];
uniform vec3 uCol[${MAX}];
uniform float uLvl[${MAX}];
uniform float uVis[${MAX}];
uniform vec3 uPtr;
uniform vec3 uMix;    // everyone's colors blended (ground light, embers)
uniform float uEmpty; // 1 when nobody is at the fire

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

// Heat ramp in one hue: dark edge, full color body, pale hot core
vec3 ramp(float t, vec3 c) {
  t = clamp(t, 0.0, 1.0);
  vec3 o = mix(vec3(0.0), c * 0.3, smoothstep(0.0, 0.25, t));
  o = mix(o, c, smoothstep(0.2, 0.55, t));
  o = mix(o, mix(c, vec3(1.0), 0.18), smoothstep(0.5, 0.8, t));
  o = mix(o, mix(c, vec3(1.0), 0.5), smoothstep(0.82, 1.0, t));
  return o;
}

// q: flame-local coords, base at origin, y up, unit = fire size
float flame(vec2 q, float t, float seed, float width, float height) {
  float h = q.y / height;
  if (h < -0.25 || h > 1.5 || abs(q.x) > width * 2.6 + 0.2) return 0.0;
  float n = fbm(vec2(q.x * 3.0 + seed, q.y * 2.2 - t * 2.4));
  float sway = (n - 0.5) * 0.6 * clamp(h, 0.0, 1.0);
  float w = width * (1.0 - smoothstep(0.0, 1.0, h)) * (0.85 + 0.3 * n) + 0.004;
  float body = 1.0 - abs(q.x + sway) / w;
  float erode = fbm(vec2(q.x * 5.0 - seed, q.y * 4.0 - t * 3.8));
  body -= erode * 0.95 * smoothstep(0.05, 1.0, h);
  body *= smoothstep(-0.25, 0.04, h);
  return clamp(body, 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float t = uTime;
  vec2 fb = uFire.xy;
  float fs = uFire.z;
  vec2 q = (p - fb) / fs;
  q.y = -q.y;

  // Ground: warm near-black, light pooling around the fire
  vec3 col = vec3(0.050, 0.030, 0.024);
  vec2 lightC = fb - vec2(0.0, fs * 0.45);
  float ld = length((p - lightC) / vec2(uRes.x * 0.55, uRes.y * 0.5));
  float flick = 0.92 + 0.08 * noise(vec2(t * 3.1, 0.0));
  col += uMix * 0.55 * exp(-ld * ld * 3.2) * (0.20 + 0.16 * uHeat) * flick * (0.5 + 0.5 * uFireAlpha) * (1.0 - 0.6 * uEmpty);
  vec2 uv = p / uRes;
  col *= 0.72 + 0.28 * smoothstep(1.15, 0.25, length((uv - 0.5) * vec2(1.0, 0.9)));

  // The fire
  if (q.y > -0.4 && q.y < 2.0 && abs(q.x) < 1.2) {
    float heat = 0.9 + 0.3 * uHeat;
    float f = flame(q, t, 0.0, 0.30, 1.0 * heat);
    float core = flame(q * vec2(1.7, 1.3), t * 1.2, 4.0, 0.26, 0.75 * heat);
    float I = f * 0.8 + core * 0.55;

    // The fire's color is only the people in it. Each person owns a band of
    // the flame that swirls upward and blends into their neighbors; louder
    // voices push their color further across.
    float nn = float(uN);
    float swirl = (fbm(vec2(q.x * 2.2, q.y * 1.6 - t * 1.4)) - 0.5) * (0.12 + 0.35 * clamp(q.y, 0.0, 1.0));
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < ${MAX}; i++) {
      if (i >= uN) break;
      float xo = (float(i) - (nn - 1.0) * 0.5) * min(0.11, 0.5 / nn);
      float w = exp(-pow((q.x + swirl - xo) / 0.075, 2.0)) * uVis[i] * (1.0 + 2.5 * uLvl[i]) + 0.0005 * uVis[i];
      acc += uCol[i] * w;
      wsum += w;
    }
    vec3 hue = wsum > 0.0 ? acc / wsum : uMix;
    vec3 fc = ramp(I, hue) * smoothstep(0.0, 0.08, I);

    // Each person's own tongue rises out of the fire when they talk
    for (int i = 0; i < ${MAX}; i++) {
      if (i >= uN) break;
      float fi = float(i);
      float xo = (fi - (nn - 1.0) * 0.5) * min(0.11, 0.5 / nn);
      float lvl = uLvl[i];
      float tg = flame(q - vec2(xo, 0.02), t * 1.1 + fi * 1.7, fi * 13.0, 0.085 + 0.04 * lvl,
                       (0.5 + 0.95 * lvl + 0.08 * sin(t * 1.3 + fi * 2.0)) * heat);
      tg *= uVis[i];
      fc += uCol[i] * tg * 0.9 + mix(uCol[i], vec3(1.0), 0.6) * pow(tg, 3.0) * 0.3;
    }
    // Ember bed under the flames
    float bed = exp(-pow(q.x / 0.36, 2.0) - pow((q.y + 0.02) / 0.05, 2.0));
    fc += hue * 0.85 * bed * (0.55 + 0.45 * noise(vec2(q.x * 14.0, t * 2.0)));
    col += fc * uFireAlpha * (1.0 - 0.65 * uEmpty);
  }

  // Flames around each tile
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    vec4 r = uRect[i];
    if (r.z < 1.0) continue;
    vec2 hs = r.zw * 0.5;
    vec2 lp = p - (r.xy + hs);
    float rad = 22.0;
    vec2 dq = abs(lp) - hs + rad;
    float d = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - rad;
    if (d < -1.0 || d > 260.0) continue;
    float lvl = uLvl[i];
    float up = clamp(-(lp.y + hs.y) / (hs.y * 1.2 + 40.0), 0.0, 1.0);
    float reach = (9.0 + 30.0 * lvl) * (1.0 + up * 2.6);
    float glow = exp(-d / reach);
    float n = fbm(vec2(lp.x / 34.0 + float(i) * 5.3, lp.y / 26.0 + t * (1.5 + lvl)));
    float tongues = smoothstep(0.42, 0.95, glow * (0.5 + n));
    float below = clamp((lp.y - hs.y * 0.2) / hs.y, 0.0, 1.0);
    float a = (glow * 0.32 + tongues * 0.85) * (0.30 + 1.15 * lvl) * uVis[i] * (1.0 - 0.6 * below);
    col += uCol[i] * a + vec3(1.0, 0.86, 0.66) * pow(a, 2.4) * 0.4;
  }

  // Embers rising — denser above the fire
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float cs = 44.0 + fl * 30.0;
    vec2 ep = p / cs;
    ep.y += t * (0.55 + 0.25 * fl) * (1.0 + 0.3 * uHeat);
    ep.x += sin(ep.y * 0.7 + fl * 2.0 + t * 0.3) * 0.35;
    vec2 cell = floor(ep);
    vec2 fr = fract(ep);
    float h = hash(cell + fl * 31.0);
    float near = exp(-pow((p.x - fb.x) / (fs * 1.4 + uRes.x * 0.1), 2.0)) * clamp((fb.y - p.y) / (fs * 3.0), 0.0, 1.0);
    float thresh = 0.9 - 0.12 * near * uFireAlpha;
    if (h > thresh) {
      vec2 pos = vec2(hash(cell + 7.1), hash(cell + 3.3)) * 0.7 + 0.15;
      float dd = length(fr - pos);
      float tw = 0.55 + 0.45 * sin(t * (3.0 + h * 5.0) + h * 60.0);
      float e = smoothstep(0.075, 0.0, dd) * tw * (0.35 + 0.9 * near);
      col += mix(uMix, vec3(1.0), 0.15 + 0.35 * hash(cell + 1.7)) * e * (1.0 - fl * 0.22);
    }
  }

  // Candle-glow under the cursor
  float pd = length(p - uPtr.xy);
  col += uMix * exp(-pd * pd / (2.0 * 110.0 * 110.0)) * 0.09 * uPtr.z;

  col = 1.0 - exp(-col * 1.4);
  col += (hash(p * 0.37 + fract(t * 7.0)) - 0.5) * 0.014;
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

interface Smooth {
  lvl: number;
  vis: number;
  rect: [number, number, number, number];
}

export default function FireCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const failedRef = useRef(false);

  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) {
      failedRef.current = true;
      canvas.style.display = "none";
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch (err) {
      console.warn("fire shader unavailable", err);
      canvas.style.display = "none";
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = {
      res: u("uRes"), scale: u("uScale"), time: u("uTime"), fire: u("uFire"), fireAlpha: u("uFireAlpha"),
      heat: u("uHeat"), n: u("uN"), rect: u("uRect[0]"), col: u("uCol[0]"), lvl: u("uLvl[0]"), vis: u("uVis[0]"), ptr: u("uPtr"), mix: u("uMix"), empty: u("uEmpty"),
    };

    const mobile = matchMedia("(pointer: coarse)").matches;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scale = mobile ? 0.4 : 0.55;
    const minScale = 0.28;
    let raf = 0;
    let last = 0;
    let slowFrames = 0;
    let fastFrames = 0;
    const t0 = performance.now();
    const smooth = new Map<string, Smooth>();
    const fire = { ...scene.fire };
    let fireAlpha = scene.fireAlpha;
    let heat = 0;
    // Smoothed blend of everyone's colors, and how empty the fire is
    const mixColor = [0.8, 0.72, 0.66];
    let empty = 1;

    const rects = new Float32Array(MAX * 4);
    const cols = new Float32Array(MAX * 3);
    const lvls = new Float32Array(MAX);
    const vis = new Float32Array(MAX);

    function resize() {
      const w = Math.max(1, Math.round(innerWidth * scale));
      const h = Math.max(1, Math.round(innerHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      const dtMs = now - last;
      // ~45fps is plenty for fire and saves battery
      if (dtMs < (mobile ? 30 : 21)) return;
      last = now;

      // Adaptive resolution: back off if the GPU is struggling
      if (dtMs > 40) slowFrames++;
      else if (dtMs < 26) fastFrames++;
      if (slowFrames > 20 && scale > minScale) {
        scale = Math.max(minScale, scale * 0.85);
        slowFrames = fastFrames = 0;
      } else if (fastFrames > 240 && scale < (mobile ? 0.45 : 0.6)) {
        scale = Math.min(mobile ? 0.45 : 0.6, scale * 1.08);
        slowFrames = fastFrames = 0;
      }
      resize();

      const k = Math.min(1, dtMs / 1000 * 4);
      fire.x += (scene.fire.x - fire.x) * k;
      fire.y += (scene.fire.y - fire.y) * k;
      fire.size += (scene.fire.size - fire.size) * k;
      fireAlpha += (scene.fireAlpha - fireAlpha) * k;
      scene.flare *= Math.pow(0.5, dtMs / 900);

      const people = scene.people.slice(0, MAX);
      let talk = 0;
      const seen = new Set<string>();
      people.forEach((p, i) => {
        seen.add(p.sid);
        let s = smooth.get(p.sid);
        if (!s) smooth.set(p.sid, (s = { lvl: 0, vis: 0, rect: [0, 0, 0, 0] }));
        const target = audioLevels.fire(p.sid);
        s.lvl += (target - s.lvl) * Math.min(1, dtMs / 90);
        s.vis += ((p.leaving ? 0 : 1) - s.vis) * Math.min(1, dtMs / 500);
        if (p.el?.isConnected) {
          const r = p.el.getBoundingClientRect();
          s.rect = [r.left, r.top, r.width, r.height];
        } else {
          s.rect[2] = 0;
        }
        talk = Math.max(talk, s.lvl);
        rects.set(s.rect, i * 4);
        cols.set(hexToRgb(p.color), i * 3);
        lvls[i] = s.lvl;
        vis[i] = s.vis;
      });
      for (const sid of smooth.keys()) if (!seen.has(sid)) smooth.delete(sid);
      heat += (Math.min(1.6, scene.flare + talk * 0.6) - heat) * Math.min(1, dtMs / 200);

      // Weighted average of the colors present, re-saturated to the average
      // vividness of the inputs so complementary colors don't turn to mud
      let r = 0, g = 0, b = 0, w = 0, chroma = 0;
      for (let i = 0; i < people.length; i++) {
        const wi = vis[i] * (1 + 2 * lvls[i]);
        const cr = cols[i * 3], cg = cols[i * 3 + 1], cb = cols[i * 3 + 2];
        r += cr * wi; g += cg * wi; b += cb * wi;
        chroma += (Math.max(cr, cg, cb) - Math.min(cr, cg, cb)) * wi;
        w += wi;
      }
      const target = [0.8, 0.72, 0.66];
      if (w > 0.001) {
        const avg = [r / w, g / w, b / w];
        const m = (avg[0] + avg[1] + avg[2]) / 3;
        const c0 = Math.max(...avg) - Math.min(...avg);
        const k = c0 > 0.01 ? Math.min(4, chroma / w / c0) : 1;
        for (let j = 0; j < 3; j++) target[j] = Math.max(0, Math.min(1, m + (avg[j] - m) * k));
      }
      const km = Math.min(1, dtMs / 400);
      for (let j = 0; j < 3; j++) mixColor[j] += (target[j] - mixColor[j]) * km;
      empty += ((w > 0.05 ? 0 : 1) - empty) * km;

      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.uniform2f(U.res, innerWidth, innerHeight);
      gl!.uniform1f(U.scale, canvas.width / innerWidth);
      gl!.uniform1f(U.time, ((now - t0) / 1000) * (reduced ? 0.35 : 1));
      gl!.uniform3f(U.fire, fire.x, fire.y, fire.size);
      gl!.uniform1f(U.fireAlpha, fireAlpha);
      gl!.uniform1f(U.heat, heat);
      gl!.uniform1i(U.n, people.length);
      gl!.uniform4fv(U.rect, rects);
      gl!.uniform3fv(U.col, cols);
      gl!.uniform1fv(U.lvl, lvls);
      gl!.uniform1fv(U.vis, vis);
      gl!.uniform3f(U.ptr, scene.pointer.x, scene.pointer.y, scene.pointer.active);
      gl!.uniform3f(U.mix, mixColor[0], mixColor[1], mixColor[2]);
      gl!.uniform1f(U.empty, empty);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }
    raf = requestAnimationFrame(draw);

    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      canvas.style.display = "none";
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", lost);
    };
  }, []);

  return (
    <>
      {/* CSS fallback glow if WebGL is unavailable (sits under the canvas) */}
      <div className="fire-fallback" aria-hidden />
      <canvas ref={ref} className="fire-canvas" aria-hidden />
    </>
  );
}
