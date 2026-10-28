// Voice level metering, outside React.
//
// One AudioContext, one AnalyserNode per audio track. A RAF loop computes a
// perceptual 0–1 level per session and writes it straight onto bound DOM nodes
// as the CSS variable --lvl (and data-speaking), so speaking never re-renders
// the React tree. The fire shader reads levels directly via audioLevels.get().

interface Entry {
  trackId: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Float32Array<ArrayBuffer>;
  level: number;
  speaking: boolean;
  lastLoud: number;
}

const FLOOR_DB = -58;
const CEIL_DB = -18;

let ctx: AudioContext | null = null;
const entries = new Map<string, Entry>();
const bound = new Map<string, Set<HTMLElement>>();
const written = new Map<HTMLElement, string>();

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
  return ctx;
}

function remove(sid: string) {
  const e = entries.get(sid);
  if (!e) return;
  try {
    e.source.disconnect();
  } catch {}
  entries.delete(sid);
}

function frame() {
  const now = performance.now();
  for (const e of entries.values()) {
    e.analyser.getFloatTimeDomainData(e.data);
    let sum = 0;
    for (let i = 0; i < e.data.length; i++) sum += e.data[i] * e.data[i];
    const rms = Math.sqrt(sum / e.data.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    const raw = Math.max(0, Math.min(1, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
    // Fast attack, slow release — glow jumps with a syllable, then settles
    e.level += (raw - e.level) * (raw > e.level ? 0.45 : 0.08);
    if (e.level > 0.22) e.lastLoud = now;
    e.speaking = e.level > 0.22 || now - e.lastLoud < 450;
  }
  for (const [sid, els] of bound) {
    const e = entries.get(sid);
    const lvl = e ? e.level.toFixed(2) : "0.00";
    const speaking = e?.speaking ? "1" : "0";
    for (const el of els) {
      const key = lvl + speaking;
      if (written.get(el) === key) continue;
      written.set(el, key);
      el.style.setProperty("--lvl", lvl);
      el.dataset.speaking = speaking;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export const audioLevels = {
  /** Keep analysers in sync with the current set of streams (sid → stream). */
  sync(streams: Map<string, MediaStream>) {
    for (const sid of [...entries.keys()]) {
      const track = streams.get(sid)?.getAudioTracks()[0];
      if (!track || track.id !== entries.get(sid)!.trackId || track.readyState === "ended") remove(sid);
    }
    for (const [sid, stream] of streams) {
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended" || entries.has(sid)) continue;
      const c = ensureCtx();
      if (!c) return;
      try {
        // Analyse just this track, so later video-track churn doesn't matter
        const source = c.createMediaStreamSource(new MediaStream([track]));
        const analyser = c.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        entries.set(sid, {
          trackId: track.id, source, analyser, data: new Float32Array(analyser.fftSize),
          level: 0, speaking: false, lastLoud: 0,
        });
      } catch {
        // AudioContext unavailable — glow simply stays calm
      }
    }
  },

  /** Write --lvl / data-speaking for `sid` onto `el` every frame. Returns an unbind fn. */
  bind(sid: string, el: HTMLElement): () => void {
    let set = bound.get(sid);
    if (!set) bound.set(sid, (set = new Set()));
    set.add(el);
    return () => {
      set!.delete(el);
      written.delete(el);
      if (!set!.size) bound.delete(sid);
    };
  },

  get(sid: string): number {
    return entries.get(sid)?.level ?? 0;
  },

  /** Browsers start AudioContexts suspended until a user gesture. */
  resume() {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  },
};
