const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const videoEl = /** @type {HTMLVideoElement} */ ($("video"));
const viewCanvas = /** @type {HTMLCanvasElement} */ ($("view"));
const motionCanvas = /** @type {HTMLCanvasElement} */ ($("motiongram"));
const viewCtx = /** @type {CanvasRenderingContext2D} */ (viewCanvas.getContext("2d", { alpha: false }));
const motionCtx = /** @type {CanvasRenderingContext2D} */ (
  motionCanvas.getContext("2d", { alpha: false })
);

const statusEl = $("status");
const audioStatusEl = $("audioStatus");

const startCamBtn = /** @type {HTMLButtonElement} */ ($("startCam"));
const stopCamBtn = /** @type {HTMLButtonElement} */ ($("stopCam"));
const startAudioBtn = /** @type {HTMLButtonElement} */ ($("startAudio"));
const stopAudioBtn = /** @type {HTMLButtonElement} */ ($("stopAudio"));

const diffGainEl = /** @type {HTMLInputElement} */ ($("diffGain"));
const diffGainVal = $("diffGainVal");
const floorEl = /** @type {HTMLInputElement} */ ($("floor"));
const floorVal = $("floorVal");
const fftSizeEl = /** @type {HTMLInputElement} */ ($("fftSize"));
const colsPerSecEl = /** @type {HTMLInputElement} */ ($("colsPerSec"));
const colsPerSecVal = $("colsPerSecVal");
const minHzEl = /** @type {HTMLInputElement} */ ($("minHz"));
const minHzVal = $("minHzVal");
const maxHzEl = /** @type {HTMLInputElement} */ ($("maxHz"));
const maxHzVal = $("maxHzVal");
const silenceEl = /** @type {HTMLInputElement} */ ($("silence"));
const silenceVal = $("silenceVal");
const loudnessEl = /** @type {HTMLInputElement} */ ($("loudness"));
const loudnessVal = $("loudnessVal");
const smoothEl = /** @type {HTMLInputElement} */ ($("smooth"));
const smoothVal = $("smoothVal");

function setStatus(msg) {
  statusEl.textContent = msg;
}
function setAudioStatus(msg) {
  audioStatusEl.textContent = msg;
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

diffGainEl.addEventListener("input", () => {
  diffGainVal.textContent = Number(diffGainEl.value).toFixed(2);
});
floorEl.addEventListener("input", () => {
  floorVal.textContent = Number(floorEl.value).toFixed(3);
});
colsPerSecEl.addEventListener("input", () => {
  colsPerSecVal.textContent = String(Number(colsPerSecEl.value) | 0);
});
minHzEl.addEventListener("input", () => {
  minHzVal.textContent = String(Number(minHzEl.value) | 0);
  pushAudioConfig();
});
maxHzEl.addEventListener("input", () => {
  maxHzVal.textContent = String(Number(maxHzEl.value) | 0);
  pushAudioConfig();
});
silenceEl.addEventListener("input", () => {
  silenceVal.textContent = Number(silenceEl.value).toFixed(3);
  pushAudioConfig();
});
loudnessEl.addEventListener("input", () => {
  loudnessVal.textContent = Number(loudnessEl.value).toFixed(2);
});
smoothEl.addEventListener("input", () => {
  smoothVal.textContent = Number(smoothEl.value).toFixed(2);
});

diffGainVal.textContent = Number(diffGainEl.value).toFixed(2);
floorVal.textContent = Number(floorEl.value).toFixed(3);
colsPerSecVal.textContent = String(Number(colsPerSecEl.value) | 0);
minHzVal.textContent = String(Number(minHzEl.value) | 0);
maxHzVal.textContent = String(Number(maxHzEl.value) | 0);
silenceVal.textContent = Number(silenceEl.value).toFixed(3);
loudnessVal.textContent = Number(loudnessEl.value).toFixed(2);
smoothVal.textContent = Number(smoothEl.value).toFixed(2);

/** @type {MediaStream | null} */
let stream = null;
let rafId = 0;

// Offscreen processing resolution (kept small for speed/stability).
const PROC_W = 240;
const PROC_H = 135;
const procCanvas = document.createElement("canvas");
procCanvas.width = PROC_W;
procCanvas.height = PROC_H;
const procCtx = /** @type {CanvasRenderingContext2D} */ (
  procCanvas.getContext("2d", { willReadFrequently: true })
);

/** @type {Uint8ClampedArray | null} */
let prevRGBA = null;
/** @type {Float32Array | null} */
let smoothMotion = null;

// Motiongram storage for rendering (scrolling image).
let mgX = 0;

// Audio synth state.
/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {AudioWorkletNode | null} */
let synthNode = null;
/** @type {MessagePort | null} */
let synthPort = null;

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function validateFftSize() {
  const raw = Number(fftSizeEl.value);
  const clamped = Math.min(4096, Math.max(256, Math.floor(raw)));
  const pow2 = nextPow2(clamped);
  fftSizeEl.value = String(pow2);
  return pow2;
}

function clampRange(minHz, maxHz) {
  const min = Math.max(0, Math.min(minHz, maxHz - 10));
  const max = Math.max(min + 10, maxHz);
  return { min, max };
}

function pushAudioConfig() {
  if (!audioCtx || !synthPort) return;
  const fftSize = validateFftSize();
  const cps = Number(colsPerSecEl.value) | 0;
  const hop = Math.max(64, Math.min(fftSize >> 1, Math.round(audioCtx.sampleRate / Math.max(1, cps))));
  const { min, max } = clampRange(Number(minHzEl.value), Number(maxHzEl.value));
  const silence = Math.max(0, Number(silenceEl.value));

  // Keep UI consistent if user drags sliders past each other.
  if (min !== Number(minHzEl.value)) minHzEl.value = String(min);
  if (max !== Number(maxHzEl.value)) maxHzEl.value = String(max);
  minHzVal.textContent = String(min | 0);
  maxHzVal.textContent = String(max | 0);

  synthPort.postMessage({ type: "config", fftSize, hop, minHz: min, maxHz: max, silence });
  setAudioStatus(`audio: running (N=${fftSize}, hop=${hop}, ${min}-${max}Hz, silence=${silence.toFixed(3)})`);
}

async function startCamera() {
  if (stream) return;

  setStatus("requesting camera…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });
  } catch (err) {
    setStatus(`camera error: ${String(err)}`);
    stream = null;
    return;
  }

  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});

  prevRGBA = null;
  smoothMotion = null;
  mgX = 0;

  motionCtx.fillStyle = "#07080c";
  motionCtx.fillRect(0, 0, motionCanvas.width, motionCanvas.height);

  startCamBtn.disabled = true;
  stopCamBtn.disabled = false;
  startAudioBtn.disabled = false;

  setStatus("running");
  rafId = requestAnimationFrame(loop);
}

function stopCamera() {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
  stream = null;
  videoEl.srcObject = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;

  prevRGBA = null;
  smoothMotion = null;

  startCamBtn.disabled = false;
  stopCamBtn.disabled = true;
  startAudioBtn.disabled = true;

  setStatus("stopped");
}

function drawView() {
  const vw = videoEl.videoWidth || 1;
  const vh = videoEl.videoHeight || 1;
  const cw = viewCanvas.width;
  const ch = viewCanvas.height;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  viewCtx.imageSmoothingEnabled = true;
  viewCtx.drawImage(videoEl, dx, dy, dw, dh);
}

function computeMotionColumn() {
  // Draw downscaled frame.
  procCtx.drawImage(videoEl, 0, 0, PROC_W, PROC_H);
  const img = procCtx.getImageData(0, 0, PROC_W, PROC_H);
  const rgba = img.data;

  if (!prevRGBA) {
    prevRGBA = new Uint8ClampedArray(rgba);
    // One motion value per row (full frame height).
    smoothMotion = new Float32Array(PROC_H);
    return null;
  }

  /** @type {Float32Array} */
  const col = new Float32Array(PROC_H);
  const gain = Number(diffGainEl.value);
  const gate = Number(floorEl.value);
  const smooth = Number(smoothEl.value);

  // Average abs-diff over columns for each y (captures full height).
  // Use luma-like weights for perceptual stability.
  for (let y = 0; y < PROC_H; y++) {
    let i = (y * PROC_W) << 2;
    let acc = 0;
    for (let x = 0; x < PROC_W; x++, i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const pr = prevRGBA[i];
      const pg = prevRGBA[i + 1];
      const pb = prevRGBA[i + 2];

      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;
      // luma-weighted abs diff, normalized to [0..1] roughly.
      const d = (Math.abs(dr) * 0.2126 + Math.abs(dg) * 0.7152 + Math.abs(db) * 0.0722) / 255;
      acc += d;
    }
    col[y] = acc;
  }

  const invW = 1 / PROC_W;
  for (let y = 0; y < PROC_H; y++) {
    let v = col[y] * invW * gain;
    v = v < gate ? 0 : v;
    v = clamp01(v);
    col[y] = v;
  }

  // Exponential smoothing in motion domain for calmer audio.
  if (!smoothMotion) smoothMotion = new Float32Array(PROC_H);
  for (let y = 0; y < PROC_H; y++) {
    smoothMotion[y] = smoothMotion[y] * smooth + col[y] * (1 - smooth);
  }

  prevRGBA.set(rgba);
  return smoothMotion;
}

function renderMotiongram(col) {
  const w = motionCanvas.width;
  const h = motionCanvas.height;

  // Scroll left by 1px by shifting image data on-canvas (fast enough at this size).
  // If you want more performance, we can do a ring-buffer image and drawImage slices.
  motionCtx.drawImage(motionCanvas, -1, 0);

  // Draw newest column at right edge.
  const x = w - 1;
  const img = motionCtx.createImageData(1, h);
  const data = img.data;

  // Map row-motion values -> h pixels vertically (top=top of frame).
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const bin = Math.min(col.length - 1, Math.max(0, Math.round(t * (col.length - 1))));
    const v = col[bin]; // 0..1

    // Nice colormap-ish: deep purple -> blue -> white.
    const r = Math.min(255, Math.floor(40 + v * 220));
    const g = Math.min(255, Math.floor(30 + v * 200));
    const b = Math.min(255, Math.floor(80 + v * 255));
    const idx = y << 2;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;
  }

  motionCtx.putImageData(img, x, 0);
}

let lastColAt = 0;
function loop(ts) {
  if (!stream) return;
  drawView();

  const cps = Number(colsPerSecEl.value) | 0;
  const minDt = 1000 / Math.max(1, cps);
  if (!lastColAt) lastColAt = ts;

  if (ts - lastColAt >= minDt) {
    lastColAt = ts;
    const col = computeMotionColumn();
    if (col) {
      renderMotiongram(col);
      if (synthPort) {
        // Use a "peak-ish" motion metric so sparse motion still triggers sound.
        // Mean-of-all-rows can be too small (most rows are static), causing over-gating.
        let maxV = 0;
        let sum = 0;
        for (let i = 0; i < col.length; i++) {
          const v = col[i];
          sum += v;
          if (v > maxV) maxV = v;
        }
        const mean = sum / col.length;
        const level = Math.max(maxV, mean * 3);
        synthPort.postMessage({
          type: "motionColumn",
          column: Array.from(col),
          level,
          loudness: Number(loudnessEl.value),
        });
      }
    }
  }

  rafId = requestAnimationFrame(loop);
}

async function startAudio() {
  if (audioCtx) return;
  if (!stream) {
    setAudioStatus("audio: start camera first");
    return;
  }

  const fftSize = validateFftSize();

  audioCtx = new AudioContext({ latencyHint: "interactive" });
  setAudioStatus("audio: initializing…");

  // Inline worklet module to keep this repo dependency-free.
  const workletCode = `
  const TAU = Math.PI * 2;

  function isPow2(n) { return (n & (n - 1)) === 0 && n !== 0; }

  // Radix-2 Cooley-Tukey FFT. If inverse=true, output is unnormalized;
  // we normalize by 1/N at the end for iFFT.
  function fftRadix2(re, im, inverse) {
    const n = re.length;
    // Bit-reversal permutation.
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let tr = re[i]; re[i] = re[j]; re[j] = tr;
        let ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 1 : -1) * TAU / len;
      const wlen_r = Math.cos(ang);
      const wlen_i = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wr = 1, wi = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const u_r = re[i + k];
          const u_i = im[i + k];
          const v_r = re[i + k + half] * wr - im[i + k + half] * wi;
          const v_i = re[i + k + half] * wi + im[i + k + half] * wr;
          re[i + k] = u_r + v_r;
          im[i + k] = u_i + v_i;
          re[i + k + half] = u_r - v_r;
          im[i + k + half] = u_i - v_i;
          const nwr = wr * wlen_r - wi * wlen_i;
          wi = wr * wlen_i + wi * wlen_r;
          wr = nwr;
        }
      }
    }
  }

  class MotionIFFTProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.N = 1024;
      this.hop = 256;
      this.win = null;
      this.ring = new Float32Array(48000 * 2);
      this.ringW = 0;
      this.ringR = 0;
      this.minHz = 80;
      this.maxHz = 2000;
      this.silence = 0.02;
      this.motionEnv = 0;

      this.pendingCols = [];
      this.loudness = 0.6;
      this.lastMotion = null;
      this.seed = 1;

      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m || !m.type) return;
        if (m.type === "config") {
          const N = m.fftSize | 0;
          const hop = m.hop | 0;
          if (N >= 256 && N <= 4096 && isPow2(N) && hop > 0 && hop <= N) {
            this.N = N;
            this.hop = hop;
            this.win = null;
          }
          if (typeof m.minHz === "number") this.minHz = Math.max(0, m.minHz);
          if (typeof m.maxHz === "number") this.maxHz = Math.max(this.minHz + 1, m.maxHz);
          if (typeof m.silence === "number") this.silence = Math.max(0, m.silence);
        } else if (m.type === "motionColumn") {
          this.loudness = typeof m.loudness === "number" ? m.loudness : this.loudness;
          // Column arrives as normal Array.
          this.pendingCols.push({ col: m.column, level: m.level || 0 });
        }
      };
    }

    _ensureWindow() {
      if (this.win && this.win.length === this.N) return;
      const w = new Float32Array(this.N);
      // Hann window for overlap-add.
      for (let i = 0; i < this.N; i++) {
        w[i] = 0.5 - 0.5 * Math.cos((TAU * i) / (this.N - 1));
      }
      this.win = w;
    }

    _rand() {
      // xorshift32
      let x = this.seed | 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.seed = x | 0;
      // [0,1)
      return ((x >>> 0) / 4294967296);
    }

    _writeRing(samples) {
      const n = this.ring.length;
      for (let i = 0; i < samples.length; i++) {
        this.ring[this.ringW] = samples[i];
        this.ringW = (this.ringW + 1) % n;
        // Drop old data if overrun.
        if (this.ringW === this.ringR) this.ringR = (this.ringR + 1) % n;
      }
    }

    _readRing(out) {
      const n = this.ring.length;
      for (let i = 0; i < out.length; i++) {
        if (this.ringR === this.ringW) {
          out[i] = 0;
        } else {
          out[i] = this.ring[this.ringR];
          this.ringR = (this.ringR + 1) % n;
        }
      }
    }

    _colToFrame(col, motionLevel) {
      // Build a real time-domain frame by creating a conjugate-symmetric spectrum.
      // Use motion column as magnitudes; random phase for each bin.
      this._ensureWindow();
      const N = this.N;
      const re = new Float32Array(N);
      const im = new Float32Array(N);

      const colLen = col.length;
      let energy = 0;

      // DC and Nyquist are real.
      re[0] = 0;
      im[0] = 0;
      re[N >> 1] = 0;
      im[N >> 1] = 0;

      // Map column samples to magnitude bins (skip 0).
      // Only fill bins within [minHz, maxHz] to control brightness/high-frequency content.
      const sr = sampleRate;
      const hzPerBin = sr / N;
      let kMin = Math.floor(this.minHz / hzPerBin);
      let kMax = Math.ceil(this.maxHz / hzPerBin);
      if (kMin < 1) kMin = 1;
      const nyq = (N >> 1) - 1;
      if (kMax > nyq) kMax = nyq;
      if (kMax < kMin) {
        kMin = 1;
        kMax = Math.min(nyq, 64);
      }

      for (let k = 1; k < (N >> 1); k++) {
        if (k < kMin || k > kMax) continue;
        const t = (k - kMin) / Math.max(1, (kMax - kMin));
        const idx = Math.min(colLen - 1, Math.max(0, Math.round(t * (colLen - 1))));
        let mag = col[idx];
        if (mag < 0) mag = 0;
        // Slight tilt: emphasize lower bins so it’s more audible.
        mag = mag * (1.25 - 0.95 * t);
        // Global boost so typical motion produces audible output.
        mag *= 8.0;
        const ph = this._rand() * TAU;
        const r = mag * Math.cos(ph);
        const ii = mag * Math.sin(ph);
        re[k] = r;
        im[k] = ii;
        re[N - k] = r;
        im[N - k] = -ii;
        energy += mag;
      }

      // iFFT
      fftRadix2(re, im, true);
      const invN = 1 / N;
      const frame = new Float32Array(N);
      // Normalize and window
      for (let i = 0; i < N; i++) {
        frame[i] = re[i] * invN * this.win[i];
      }

      // Silence when not moving: a smooth gate on overall motion level.
      const thr = this.silence;
      const gate = motionLevel <= thr ? 0 : Math.min(1, (motionLevel - thr) / Math.max(1e-6, (1 - thr)));
      // Motion-driven gain (avoid silence / clipping).
      const g = Math.min(1.0, this.loudness * gate * (0.7 + 2.6 * energy / (N >> 1)));
      for (let i = 0; i < N; i++) frame[i] *= g;
      return frame;
    }

    _synthesizeIfNeeded() {
      // Keep at least ~3 hops buffered.
      const buffered = (this.ringW - this.ringR + this.ring.length) % this.ring.length;
      const target = this.hop * 6;
      if (buffered >= target) return;

      while (((this.ringW - this.ringR + this.ring.length) % this.ring.length) < target) {
        const item = this.pendingCols.length ? this.pendingCols.shift() : null;
        if (!item) {
          // No motion yet.
          this._writeRing(new Float32Array(this.hop));
          continue;
        }

        const col = item.col;
        const level = item.level;

        // Envelope so silence fades smoothly (prevents clicks).
        // Release ~150ms, attack ~20ms (in hop units).
        const attack = Math.exp(-this.hop / (sampleRate * 0.02));
        const release = Math.exp(-this.hop / (sampleRate * 0.15));
        const targetEnv = level <= this.silence ? 0 : 1;
        const coeff = targetEnv > this.motionEnv ? attack : release;
        this.motionEnv = targetEnv + (this.motionEnv - targetEnv) * coeff;

        // If we’re basically silent, don’t keep generating from old motion.
        if (this.motionEnv < 1e-3) {
          this._writeRing(new Float32Array(this.hop));
          continue;
        }

        const frame = this._colToFrame(col, level);
        // Apply envelope post-iFFT as an extra safety against clicks.
        for (let i = 0; i < frame.length; i++) frame[i] *= this.motionEnv;

        // Overlap-add: we write hop samples, but need to add tail overlaps.
        // We'll keep a small overlap buffer inside the ring by writing full hop
        // segments sequentially; because frame is windowed, summing multiple frames
        // at different offsets approximates proper OLA.
        // Implementation: write hop samples from the start of the frame; keep the
        // remaining (N-hop) part by adding into upcoming ring positions.

        // Read current hop-sized slice from ring write area (conceptually zeros),
        // so we can add overlap. We'll just write hop and then add the rest by peeking ahead.
        const hop = this.hop;
        const ringN = this.ring.length;

        // Ensure we have space: if ring nearly full, drop.
        // (Our ring is big enough; this is just safety.)
        for (let i = 0; i < hop; i++) {
          const pos = (this.ringW + i) % ringN;
          this.ring[pos] += frame[i];
        }
        for (let i = hop; i < this.N; i++) {
          const pos = (this.ringW + i) % ringN;
          this.ring[pos] += frame[i];
        }
        this.ringW = (this.ringW + hop) % ringN;
        if (this.ringW === this.ringR) this.ringR = (this.ringR + 1) % ringN;
      }
    }

    process(inputs, outputs) {
      const out = outputs[0];
      const ch0 = out[0];
      const ch1 = out[1] || null;
      this._synthesizeIfNeeded();
      this._readRing(ch0);
      if (ch1) ch1.set(ch0);
      return true;
    }
  }

  registerProcessor("motion-ifft", MotionIFFTProcessor);
  `;

  const blob = new Blob([workletCode], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await audioCtx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  synthNode = new AudioWorkletNode(audioCtx, "motion-ifft", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  synthNode.connect(audioCtx.destination);
  synthPort = synthNode.port;

  const cps = Number(colsPerSecEl.value) | 0;
  const hop = Math.max(64, Math.min(fftSize >> 1, Math.round(audioCtx.sampleRate / Math.max(1, cps))));
  const { min, max } = clampRange(Number(minHzEl.value), Number(maxHzEl.value));
  const silence = Math.max(0, Number(silenceEl.value));
  synthPort.postMessage({ type: "config", fftSize, hop, minHz: min, maxHz: max, silence });

  startAudioBtn.disabled = true;
  stopAudioBtn.disabled = false;

  setAudioStatus(
    `audio: running (N=${fftSize}, hop=${hop}, ${min}-${max}Hz, silence=${silence.toFixed(3)})`,
  );
}

async function stopAudio() {
  if (!audioCtx) return;
  setAudioStatus("audio: stopping…");
  try {
    synthPort?.postMessage({ type: "config", fftSize: 1024, hop: 256 });
    synthNode?.disconnect();
    synthNode = null;
    synthPort = null;
    await audioCtx.close();
  } finally {
    audioCtx = null;
  }
  startAudioBtn.disabled = !stream;
  stopAudioBtn.disabled = true;
  setAudioStatus("audio: stopped");
}

startCamBtn.addEventListener("click", () => startCamera());
stopCamBtn.addEventListener("click", () => stopCamera());
startAudioBtn.addEventListener("click", () => startAudio());
stopAudioBtn.addEventListener("click", () => stopAudio());

// Stop audio if camera stops.
window.addEventListener("beforeunload", () => {
  stopAudio();
  stopCamera();
});

// Initial UI.
setStatus("idle");
setAudioStatus("audio: stopped");

