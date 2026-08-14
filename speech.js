/**
 * On-air speech: neural/OpenAI via the desk server, or browser speechSynthesis.
 */

const PREFS_KEY = "pulsetext.tts";

let primed = false;
let voicesReady = null;
/** Bumped on stop / new speak so delayed starts don’t resume after cancel. */
let speakGen = 0;
/** @type {HTMLAudioElement | null} */
let audioEl = null;
/** @type {string | null} */
let audioUrl = null;
/** @type {(() => void) | null} */
let speechWait = null;

function settleSpeechWait() {
  const fn = speechWait;
  speechWait = null;
  fn?.();
}

function waitUntilSpeechDone(gen) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (speechWait === done) speechWait = null;
      resolve();
    };
    speechWait = done;
    if (gen !== speakGen) done();
  });
}

/** @type {{ engine: string, voice: string, rate: number, pitch: number, volume: number }} */
let prefs = loadLocalPrefs();

const QUALITY_RE =
  /natural|neural|online|google|premium|aria|jenny|guy|davis|sonia|michelle|andrew|ava|emma|brian|samantha|alex|karen|moira|tessa|daniel|fiona/i;
const WEAK_RE = /compact|eloquence|espeak|dummy/i;

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function normalizeEngine(raw) {
  const v = String(raw || "").trim();
  if (v === "openai" || v === "custom") return "custom";
  if (v === "browser") return "browser";
  return "neural";
}

export function normalizeSpeechPrefs(raw = {}) {
  const engine = normalizeEngine(raw.engine);
  let voice = String(raw.voice || "").trim();
  if (engine === "neural" && !voice) voice = "en-US-AriaNeural";
  return {
    engine,
    voice,
    rate: clamp(raw.rate, 0.5, 2, 1),
    pitch: clamp(raw.pitch, 0.5, 2, 1),
    volume: clamp(raw.volume, 0.1, 1, 1),
  };
}

function loadLocalPrefs() {
  try {
    return normalizeSpeechPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
  } catch {
    return normalizeSpeechPrefs({ engine: "neural", voice: "en-US-AriaNeural" });
  }
}

export function getSpeechPrefs() {
  return { ...prefs };
}

export function setSpeechPrefs(partial = {}, persist = true) {
  prefs = normalizeSpeechPrefs({ ...prefs, ...partial });
  if (persist) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore quota */
    }
  }
  return getSpeechPrefs();
}

function ensureVoices() {
  if (!window.speechSynthesis) {
    return Promise.reject(new Error("This browser can’t speak text aloud"));
  }
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const done = () => resolve(synth.getVoices());

    const existing = synth.getVoices();
    if (existing.length) {
      done();
      return;
    }

    const onChange = () => {
      synth.removeEventListener("voiceschanged", onChange);
      done();
    };
    synth.addEventListener("voiceschanged", onChange);
    setTimeout(done, 400);
  });

  return voicesReady;
}

export async function primeSpeech() {
  if (primed || !window.speechSynthesis) return;
  await ensureVoices();
  const synth = window.speechSynthesis;
  const warm = new SpeechSynthesisUtterance(".");
  warm.volume = 0;
  warm.rate = 2;
  warm.pitch = 1;
  await new Promise((resolve) => {
    warm.onend = resolve;
    warm.onerror = resolve;
    synth.speak(warm);
    setTimeout(resolve, 200);
  });
  synth.cancel();
  primed = true;
}

export function scoreVoice(v) {
  const n = `${v.name} ${v.lang}`;
  let s = 0;
  if (/^en(-|$)/i.test(v.lang || "")) s += 25;
  if (QUALITY_RE.test(n)) s += 55;
  if (WEAK_RE.test(n)) s -= 40;
  if (v.localService === false) s += 12;
  if (/david|zira|\bmark\b/i.test(n) && !QUALITY_RE.test(n)) s -= 20;
  return s;
}

export async function listVoices() {
  const voices = await ensureVoices();
  return [...(voices.length ? voices : window.speechSynthesis.getVoices())].sort(
    (a, b) => scoreVoice(b) - scoreVoice(a) || a.name.localeCompare(b.name),
  );
}

function pickVoice(voices, hint) {
  const want = String(hint || "").trim().toLowerCase();
  if (want) {
    const exact = voices.find(
      (v) =>
        v.name.toLowerCase() === want ||
        v.voiceURI.toLowerCase() === want,
    );
    if (exact) return exact;
    const fuzzy = voices.find((v) => v.name.toLowerCase().includes(want));
    if (fuzzy) return fuzzy;
  }
  const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return ranked[0] || null;
}

function stopAudio() {
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
    audioEl = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
}

/** Stop any current / queued TTS (neural audio or browser synth). */
export function stopSpeech() {
  speakGen += 1;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  stopAudio();
  settleSpeechWait();
}

export function isSpeaking() {
  const audioPlaying = Boolean(audioEl && !audioEl.paused && !audioEl.ended);
  return Boolean(
    audioPlaying ||
      window.speechSynthesis?.speaking ||
      window.speechSynthesis?.pending,
  );
}

async function speakSynth(text, use, gen) {
  if (!window.speechSynthesis) {
    throw new Error("This browser can’t speak text aloud");
  }
  const voices = await ensureVoices();
  if (gen !== speakGen) return;
  if (!primed) await primeSpeech();
  if (gen !== speakGen) return;

  const synth = window.speechSynthesis;
  synth.cancel();
  await new Promise((r) => setTimeout(r, 80));
  if (gen !== speakGen) return;

  const u = new SpeechSynthesisUtterance(text.trim());
  const voice = pickVoice(voices.length ? voices : synth.getVoices(), use.voice);
  if (voice) {
    u.voice = voice;
    if (voice.lang) u.lang = voice.lang;
  }
  u.rate = use.rate;
  u.pitch = use.pitch;
  u.volume = use.volume;
  const wait = waitUntilSpeechDone(gen);
  u.onend = settleSpeechWait;
  u.onerror = settleSpeechWait;
  synth.speak(u);
  await wait;
}

async function speakServer(text, use, gen) {
  stopAudio();
  const res = await fetch("/v1/tts/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: text.trim(),
      engine: use.engine,
      voice: use.voice,
      rate: use.rate,
      pitch: use.pitch,
    }),
  });
  if (gen !== speakGen) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "TTS failed");
  }
  const blob = await res.blob();
  if (gen !== speakGen) return;
  audioUrl = URL.createObjectURL(blob);
  audioEl = new Audio(audioUrl);
  audioEl.volume = use.volume;
  const url = audioUrl;
  const el = audioEl;
  const wait = waitUntilSpeechDone(gen);
  el.onended = settleSpeechWait;
  el.onerror = settleSpeechWait;
  try {
    await el.play();
  } catch (err) {
    settleSpeechWait();
    throw err;
  }
  await wait;
  if (audioUrl === url) {
    URL.revokeObjectURL(url);
    audioUrl = null;
    audioEl = null;
  }
}

/**
 * Speak text aloud. `voiceOrOpts` may be a voice name string or
 * `{ engine, voice, rate, pitch, volume }` (merged over saved prefs).
 */
export async function speakBrowser(text, voiceOrOpts = "") {
  if (!text?.trim()) return;

  const extra =
    typeof voiceOrOpts === "string"
      ? { voice: voiceOrOpts }
      : voiceOrOpts && typeof voiceOrOpts === "object"
        ? voiceOrOpts
        : {};
  const use = normalizeSpeechPrefs({ ...prefs, ...extra });
  const gen = ++speakGen;
  stopAudio();
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  if (use.engine === "browser") {
    await speakSynth(text, use, gen);
    return;
  }
  await speakServer(text, use, gen);
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  const kick = () => {
    ensureVoices().then(() => primeSpeech()).catch(() => {});
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kick, { once: true });
  } else {
    kick();
  }
  window.addEventListener(
    "pointerdown",
    () => {
      primeSpeech().catch(() => {});
    },
    { once: true, passive: true },
  );
}
