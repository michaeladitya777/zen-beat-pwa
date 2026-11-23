/* ZenBeat — analisis lagu offline menjadi chart.
 * Alur: decode (22,05 kHz mono) -> STFT -> flux per pita -> puncak onset -> tempo -> chart per level.
 * Semua berjalan di perangkat, tanpa internet. Hasil analisis kecil sehingga bisa disimpan di IndexedDB. */
(function (root) {
  'use strict';

  const VERSION = 1;
  const SR = 22050;
  const N = 1024;
  const HOP = 256;
  const K = N / 2;
  const BANDS = [[2, 9], [10, 39], [40, 119], [120, 349]]; // bass, bawah-tengah, tengah, atas
  const BAND_W = [1.0, 0.9, 0.8, 0.7];
  const TIME_BIAS = 0.010; // koreksi tetap (detik): uji sintetis menunjukkan deteksi ~10 ms terlalu awal
  const STRIDE = 8; // t, s, b0..b3, beat, sus

  // ---------- FFT radix-2 ----------
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const cosT = new Float64Array(N / 2);
  const sinT = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / N);
    sinT[i] = -Math.sin((2 * Math.PI * i) / N);
  }
  const rev = new Uint16Array(N);
  for (let i = 0, bits = Math.log2(N); i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }

  function fft(re, im) {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const a = start + k;
          const b = a + half;
          const tr = re[b] * cosT[w] - im[b] * sinT[w];
          const ti = re[b] * sinT[w] + im[b] * cosT[w];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  function checkCancel(ctrl) {
    if (ctrl && ctrl.cancelled) throw new Error('dibatalkan');
  }

  // ---------- Decode ----------
  async function decodeToMono(blob, ctrl) {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) throw new Error('Browser tidak mendukung analisis audio');
    const buf = await blob.arrayBuffer();
    checkCancel(ctrl);
    // decodeAudioData otomatis mengubah sample rate ke milik context (hemat memori)
    const ctx = new OAC(1, SR, SR);
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.catch) p.catch(reject);
    });
    const ch = audio.numberOfChannels;
    const len = audio.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
    }
    return { mono, sr: audio.sampleRate };
  }

  // ---------- Analisis ----------
  function percentile(arr, p) {
    const c = Float32Array.from(arr);
    c.sort();
    return c[Math.min(c.length - 1, Math.floor(p * c.length))];
  }

  async function analyzeSamples(x, sr, onProgress, ctrl, progressBase = 0, progressSpan = 1) {
    const report = (p) => onProgress && onProgress(progressBase + p * progressSpan);
    const len = x.length;
    const F = Math.floor((len - N) / HOP) + 1;
    if (F < 100) throw new Error('Lagu terlalu pendek untuk dianalisis');
    const hopSec = HOP / sr;

    let sum = 0, cnt = 0;
    for (let i = 0; i < len; i += 7) { sum += x[i] * x[i]; cnt++; }
    const rms = Math.sqrt(sum / cnt);
    if (rms < 1e-4) throw new Error('Lagu terlalu sunyi untuk dibuatkan chart');
    const gain = Math.min(40, 0.1 / rms);

    const fl = BANDS.map(() => new Float32Array(F));
    const bodyE = new Float32Array(F);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    let prev = new Float32Array(K);
    let cur = new Float32Array(K);
    const amp = 4 / N;

    const processSpectrum = (f, A_re, A_im) => {
      // A_re/A_im berisi spektrum frame f (indeks 0..K-1)
      for (let k = 0; k < K; k++) {
        const m = Math.sqrt(A_re[k] * A_re[k] + A_im[k] * A_im[k]) * amp;
        cur[k] = Math.log1p(m * 100);
      }
      let body = 0;
      for (let k = 4; k < 120; k++) body += cur[k];
      bodyE[f] = body / 116;
      if (f > 0) {
        for (let b = 0; b < 4; b++) {
          let s = 0;
          const lo = BANDS[b][0], hi = BANDS[b][1];
          for (let k = lo; k <= hi; k++) {
            const d = cur[k] - prev[k];
            if (d > 0) s += d;
          }
          fl[b][f] = s / (hi - lo + 1);
        }
      }
      const t = prev; prev = cur; cur = t;
    };

    const aRe = new Float64Array(K);
    const aIm = new Float64Array(K);
    const bRe = new Float64Array(K);
    const bIm = new Float64Array(K);
    let lastYield = performance_now();
    for (let f = 0; f < F; f += 2) {
      const o1 = f * HOP;
      const o2 = (f + 1) * HOP;
      const has2 = f + 1 < F;
      for (let j = 0; j < N; j++) {
        const w = win[j] * gain;
        re[j] = x[o1 + j] * w;
        im[j] = has2 ? x[o2 + j] * w : 0;
      }
      fft(re, im);
      // pisahkan dua spektrum real dari satu FFT kompleks
      aRe[0] = re[0]; aIm[0] = 0; bRe[0] = im[0]; bIm[0] = 0;
      for (let k = 1; k < K; k++) {
        const xr = re[k], xi = im[k], yr = re[N - k], yi = im[N - k];
        aRe[k] = (xr + yr) / 2; aIm[k] = (xi - yi) / 2;
        bRe[k] = (xi + yi) / 2; bIm[k] = (yr - xr) / 2;
      }
      processSpectrum(f, aRe, aIm);
      if (has2) processSpectrum(f + 1, bRe, bIm);

      if (performance_now() - lastYield > 40) {
        report((f / F) * 0.8);
        checkCancel(ctrl);
        await yieldUI();
        lastYield = performance_now();
      }
    }
    report(0.8);

    // Normalisasi tiap pita dengan persentil-90, lalu gabungkan
    const norm = fl.map((a) => {
      const sc = Math.max(percentile(a, 0.9), 1e-3);
      const o = new Float32Array(F);
      for (let i = 0; i < F; i++) o[i] = a[i] / sc;
      return o;
    });
    const s = new Float32Array(F);
    for (let i = 0; i < F; i++) {
      let v = 0;
      for (let b = 0; b < 4; b++) v += BAND_W[b] * norm[b][i];
      s[i] = v;
    }
    await yieldUI();
    checkCancel(ctrl);

    // Ambang adaptif: rata-rata bergerak +/- 0,4 detik
    const W = Math.round(0.4 / hopSec);
    const pre = new Float64Array(F + 1);
    for (let i = 0; i < F; i++) pre[i + 1] = pre[i] + s[i];
    let gMean = pre[F] / F;
    const thrAt = (i) => {
      const a = Math.max(0, i - W), b = Math.min(F, i + W + 1);
      return 1.35 * ((pre[b] - pre[a]) / (b - a)) + 0.35 * gMean;
    };

    const PK = 4; // puncak harus maksimum dalam +/- 4 frame (~46 ms)
    const cand = [];
    for (let i = PK; i < F - PK - 1; i++) {
      const v = s[i];
      if (v <= thrAt(i)) continue;
      let isMax = true;
      for (let j = i - PK; j <= i + PK; j++) {
        if (j !== i && (s[j] > v || (s[j] === v && j < i))) { isMax = false; break; }
      }
      if (isMax) cand.push(i);
    }

    // Tempo: autokorelasi + pencarian halus tempo/fase
    const sc0 = Float64Array.from(s);
    let mu = 0;
    for (let i = 0; i < F; i++) mu += sc0[i];
    mu /= F;
    for (let i = 0; i < F; i++) sc0[i] -= mu;
    const lagMin = Math.round(60 / 190 / hopSec);
    const lagMax = Math.round(60 / 60 / hopSec);
    const ac = new Float64Array(lagMax * 4 + 2);
    for (let lag = lagMin; lag < ac.length; lag++) {
      let a = 0;
      for (let i = 0; i + lag < F; i++) a += sc0[i] * sc0[i + lag];
      ac[lag] = a / (F - lag);
    }
    let bestLag = lagMin, bestScore = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const bpm = 60 / (lag * hopSec);
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.8, 2));
      const comb = ac[lag] + 0.5 * ac[lag * 2] + 0.25 * ac[lag * 4];
      const sc = comb * prior;
      if (sc > bestScore) { bestScore = sc; bestLag = lag; }
    }
    let bestBpm = 60 / (bestLag * hopSec), bestPhase = 0, bestVal = -Infinity;
    for (let bpm = bestBpm - 3; bpm <= bestBpm + 3; bpm += 0.1) {
      const P = 60 / bpm / hopSec;
      for (let ph = 0; ph < P; ph += 1) {
        let v = 0, n = 0;
        for (let pos = ph; pos < F - 1; pos += P) { v += s[Math.round(pos)]; n++; }
        v /= n;
        if (v > bestVal) { bestVal = v; bestBpm = bpm; bestPhase = ph; }
      }
    }
    const beatLen = 60 / bestBpm;
    const phaseSec = bestPhase * hopSec;
    report(0.9);

    // Susun data onset
    const centerOffset = (N / 2 - HOP / 2) / sr + TIME_BIAS;
    const out = new Float32Array(cand.length * STRIDE);
    for (let n = 0; n < cand.length; n++) {
      const i = cand[n];
      const a = s[i - 1], b = s[i], c = s[i + 1];
      const den = a - 2 * b + c;
      const frac = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
      const t = (i + frac) * hopSec + centerOffset;
      const o = n * STRIDE;
      out[o] = t;
      out[o + 1] = b / Math.max(thrAt(i), 1e-6);
      for (let k = 0; k < 4; k++) {
        out[o + 2 + k] = Math.max(norm[k][i - 1], norm[k][i], norm[k][i + 1]);
      }
      const d = Math.abs(((t - phaseSec - centerOffset) / beatLen) % 1);
      const dist = Math.min(d, 1 - d);
      out[o + 6] = Math.max(0, 1 - dist / 0.12);

      // Panjang nada tahan: energi badan lagu bertahan tinggi tanpa onset kuat baru
      let e0 = 0;
      for (let j = i; j < Math.min(F, i + 4); j++) e0 = Math.max(e0, bodyE[j]);
      let j = i + 4;
      const limit = Math.min(F - 1, i + Math.round(2.0 / hopSec));
      while (j < limit && bodyE[j] > e0 - 0.2) j++;
      out[o + 7] = (j - i) * hopSec;
    }
    report(1);

    return {
      version: VERSION, sr, hop: HOP, duration: len / sr,
      bpm: bestBpm, beatOffset: phaseSec, onsets: out
    };
  }

  function performance_now() {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  }

  async function analyzeBlob(blob, onProgress, ctrl) {
    if (onProgress) onProgress(0.01);
    const { mono, sr } = await decodeToMono(blob, ctrl);
    if (onProgress) onProgress(0.1);
    return analyzeSamples(mono, sr, onProgress, ctrl, 0.1, 0.9);
  }

  // ---------- Chart per level ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  const LEVEL_SHAPE = {
    easy:    { keep: 0.40, beatBoost: 0.8, holdMin: 0.45, susBoost: 0.9, holdScale: 1.6, holdMax: 1.3 },
    normal:  { keep: 0.30, beatBoost: 0.5, holdMin: 0.4, susBoost: 0.7, holdScale: 1.4, holdMax: 1.2 },
    hard:    { keep: 0.20, beatBoost: 0.2, holdMin: 0.4, susBoost: 0.3, holdScale: 0.6, holdMax: 0.9 },
    extreme: { keep: 0.00, beatBoost: 0.0, holdMin: 0.4, susBoost: 0.0, holdScale: 0.4, holdMax: 0.75 }
  };

  function buildChart(data, cfg, seedStr, levelKey) {
    const shape = LEVEL_SHAPE[levelKey] || LEVEL_SHAPE.normal;
    const rng = mulberry32(hashStr(seedStr + '|v' + VERSION));
    const on = data.onsets;
    const n = on.length / STRIDE;
    const items = [];
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      items.push({
        t: on[o], s: on[o + 1],
        v: [on[o + 2], on[o + 3], on[o + 4], on[o + 5]],
        beat: on[o + 6], sus: on[o + 7]
      });
    }
    if (!items.length) return [];
    const strengths = items.map((it) => it.s).sort((a, b) => a - b);
    const minS = strengths[Math.floor(shape.keep * strengths.length)] || 0;
    const strongS = strengths[Math.floor(0.75 * strengths.length)] || 0;

    // Pilih onset: skor tertinggi dulu, jaga jarak minimum (cooldown level)
    const gap = cfg.cooldown / 1000;
    const ranked = items
      .filter((it) => it.s >= minS)
      .map((it) => ({ it, sc: it.s * (1 + shape.beatBoost * it.beat) * (1 + shape.susBoost * Math.min(1, it.sus / 0.8)) }))
      .sort((a, b) => b.sc - a.sc);
    const taken = [];
    const times = [];
    const isFree = (t) => {
      let lo = 0, hi = times.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; }
      return !(lo < times.length && times[lo] - t < gap) && !(lo > 0 && t - times[lo - 1] < gap);
    };
    for (const r of ranked) {
      if (isFree(r.it.t)) {
        taken.push(r.it);
        const t = r.it.t;
        let lo = 0, hi = times.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; }
        times.splice(lo, 0, t);
      }
    }
    taken.sort((a, b) => a.t - b.t);

    // Susun tipe & jalur secara kronologis
    const chart = [];
    const laneBusyUntil = [-1, -1, -1, -1];
    let lastLane = -1, sameRun = 0, lastSlideT = -1e9;

    const pickLane = (v, t, exclude) => {
      const w = v.map((x, b) => ({ b, w: Math.pow(Math.max(x, 0.01), 1.5) }));
      const total = w.reduce((a, c) => a + c.w, 0);
      let r = rng() * total, first = 0;
      for (const c of w) { r -= c.w; if (r <= 0) { first = c.b; break; } }
      const order = [first, ...w.sort((a, c) => c.w - a.w).map((c) => c.b).filter((b) => b !== first)];
      for (const l of order) {
        if (exclude.includes(l) || laneBusyUntil[l] > t) continue;
        if (l === lastLane && sameRun >= 2) continue;
        return l;
      }
      for (const l of order) if (!exclude.includes(l) && laneBusyUntil[l] <= t) return l;
      return -1;
    };
    const setLast = (l) => { sameRun = l === lastLane ? sameRun + 1 : 1; lastLane = l; };

    for (let i = 0; i < taken.length; i++) {
      const it = taken[i];
      const nextGap = i + 1 < taken.length ? taken[i + 1].t - it.t : 5;
      const strong = it.s >= strongS;

      // Nada tahan
      if ((it.sus >= shape.holdMin || nextGap >= 1.2) && nextGap >= shape.holdMin + 0.35 && rng() < Math.min(0.9, cfg.holdChance * shape.holdScale)) {
        const dur = Math.max(0.35, Math.min(Math.max(it.sus, 0.6), shape.holdMax, nextGap - 0.3));
        const lane = pickLane(it.v, it.t, []);
        if (lane >= 0) {
          chart.push({ t: it.t, type: 'hold', lane, dur });
          laneBusyUntil[lane] = it.t + dur + 0.2;
          setLast(lane);
          continue;
        }
      }
      // Slide pada onset kuat, dibatasi cooldown
      if (cfg.slideChance > 0 && strong && it.t - lastSlideT >= cfg.slideCooldownMs / 1000 &&
          rng() < Math.min(0.9, cfg.slideChance * 2.2)) {
        const base = pickLane(it.v, it.t, []);
        if (base >= 0) {
          const start = Math.min(base, 2);
          if (laneBusyUntil[start] <= it.t && laneBusyUntil[start + 1] <= it.t) {
            chart.push({ t: it.t, type: 'slide', lane: start, span: 2 });
            laneBusyUntil[start] = laneBusyUntil[start + 1] = it.t + 0.3;
            lastSlideT = it.t;
            setLast(start);
            continue;
          }
        }
      }
      // Tap (dan kadang dobel)
      const lane = pickLane(it.v, it.t, []);
      if (lane < 0) continue;
      chart.push({ t: it.t, type: 'tap', lane });
      laneBusyUntil[lane] = it.t + 0.08;
      setLast(lane);
      if (strong && rng() < cfg.doubleChance * 2.2) {
        const far = [0, 1, 2, 3].filter((l) => Math.abs(l - lane) >= 2 && laneBusyUntil[l] <= it.t);
        const pool = far.length ? far : [0, 1, 2, 3].filter((l) => l !== lane && laneBusyUntil[l] <= it.t);
        if (pool.length) {
          const l2 = pool[Math.floor(rng() * pool.length)];
          chart.push({ t: it.t, type: 'tap', lane: l2 });
          laneBusyUntil[l2] = it.t + 0.08;
        }
      }
    }
    chart.sort((a, b) => a.t - b.t);
    return chart;
  }

  root.ChartAnalyzer = { VERSION, analyzeBlob, analyzeSamples, buildChart, decodeToMono };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChartAnalyzer;
})(typeof self !== 'undefined' ? self : globalThis);
