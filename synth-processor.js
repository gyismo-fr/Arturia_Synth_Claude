// Moteur DSP du synthé — tourne dans le thread audio (AudioWorklet).
// 8 voix, 2 oscillateurs polyBLEP morphables + unisson, sub, bruit, filtre ladder 4 pôles (ZDF),
// 2 ADSR, 2 LFO, arpégiateur à l'échantillon près, distorsion, chorus, delay ping-pong, reverb.

const MAXV = 8;
const MAXU = 4;
const TWO_PI = Math.PI * 2;
const ARP_DIVS = [1, 2, 3, 4, 6, 8];
const SMOOTHED = ['cut', 'res', 'o1Lvl', 'o2Lvl', 'subLvl', 'noiseLvl', 'pw', 'fm', 'drive', 'master', 'bend', 'mw'];

function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

function tanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function wave(k, p, dt, pw) {
  switch (k) {
    case 0: return -Math.cos(TWO_PI * p);
    case 1: return 1 - 4 * Math.abs(p - 0.5);
    case 2: return 2 * p - 1 - blep(p, dt);
    default: {
      let q = p - pw; if (q < 0) q += 1;
      return (p < pw ? 1 : -1) + blep(p, dt) - blep(q, dt);
    }
  }
}

// Morph continu SIN → TRI → SAW → SQR
function osc(w, p, dt, pw) {
  const i = w >= 3 ? 2 : (w | 0);
  const f = w - i;
  if (f > 0.999) return wave(i + 1, p, dt, pw);
  const y = wave(i, p, dt, pw);
  return f > 0.001 ? y + (wave(i + 1, p, dt, pw) - y) * f : y;
}

function rd(buf, mask, w, d) {
  const r = w - d;
  const i = Math.floor(r);
  const f = r - i;
  const a = buf[i & mask];
  return a + (buf[(i + 1) & mask] - a) * f;
}

const pow2size = n => { let s = 1; while (s < n) s <<= 1; return s; };

class Voice {
  constructor() {
    this.note = 60; this.target = 60; this.cur = 60; this.vel = 0;
    this.gate = false; this.sus = false; this.age = 0;
    this.p1 = new Float64Array(MAXU); this.p2 = new Float64Array(MAXU); this.o2l = new Float64Array(MAXU);
    for (let u = 0; u < MAXU; u++) { this.p1[u] = Math.random(); this.p2[u] = Math.random(); }
    this.ps = 0;
    this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0;
    this.ae = 0; this.as = 0; // amp env : niveau, étape (0 off, 1 A, 2 D/S, 4 R)
    this.fe = 0; this.fs = 0;
  }
}

class SynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = sampleRate;
    this.P = Object.assign({}, options.processorOptions.params);
    this.voices = Array.from({ length: MAXV }, () => new Voice());
    this.ageCounter = 0;
    this.lastNote = 60;
    this.stack = [];      // notes jouées en mono
    this.down = [];       // touches physiquement enfoncées {n, vel}
    this.held = [];       // notes dans l'arpège
    this.sustain = false;
    this.arpRun = false; this.arpIdx = 0; this.arpStepIn = 0; this.arpOffIn = Infinity; this.arpNote = -1;

    this.lfo1 = new Float32Array(128); this.lfo2 = new Float32Array(128);
    this.lp1 = 0; this.lp2 = 0; this.sh1 = 0; this.sh2 = 0;
    this.bus = new Float32Array(128);
    this.tg = {}; this.sm = {}; this.A = {};
    this.bendV = 0; this.mwV = 0;
    for (const k of SMOOTHED) this.A[k] = new Float32Array(128);
    this.smK = 1 - Math.exp(-1 / (0.006 * sr));

    // Chorus
    this.cSize = pow2size(Math.ceil(0.05 * sr)); this.cBuf = new Float32Array(this.cSize); this.cW = 0; this.cPh = 0;
    // Delay
    this.dSize = pow2size(Math.ceil(1.6 * sr)); this.dL = new Float32Array(this.dSize); this.dR = new Float32Array(this.dSize);
    this.dW = 0; this.dS = 0.35 * sr; this.dfL = 0; this.dfR = 0;
    this.dampK = 1 - Math.exp(-TWO_PI * 4500 / sr);
    // Reverb (Freeverb)
    const sc = sr / 44100;
    const CT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], AT = [556, 441, 341, 225];
    this.cbL = CT.map(t => new Float32Array(Math.round(t * sc)));
    this.cbR = CT.map(t => new Float32Array(Math.round((t + 23) * sc)));
    this.apL = AT.map(t => new Float32Array(Math.round(t * sc)));
    this.apR = AT.map(t => new Float32Array(Math.round((t + 23) * sc)));
    this.ciL = new Int32Array(8); this.ciR = new Int32Array(8); this.aiL = new Int32Array(4); this.aiR = new Int32Array(4);
    this.cfL = new Float64Array(8); this.cfR = new Float64Array(8);

    // Looper audio. st : 0 vide, 1 décompte, 2 enregistrement de la base, 3 lecture, 4 overdub, 5 arrêt
    this.loop = {
      st: 0, len: 0, beats: 0, bpm: 120, beatLen: 1, pos: 0, layers: [], spare: [], cur: null,
      recOn: false, recG: 0, lat: 0, vol: 0.8, metro: true, dubAfter: false, lastBeat: null,
      cEnv: 0, cPh: 0, cF: 1000, exp: null,
    };
    this.rInc = 1 / (0.005 * sr);
    this.cDec = Math.exp(-1 / (0.012 * sr));

    this.statCount = 0;
    this.derive();
    for (const k of SMOOTHED) this.sm[k] = this.tg[k];
    this.port.onmessage = e => this.onMsg(e.data);
  }

  onMsg(m) {
    switch (m[0]) {
      case 'on': this.noteOn(m[1], m[2]); break;
      case 'off': this.noteOff(m[1]); break;
      case 'p': this.setParam(m[1], m[2]); break;
      case 'ps': for (const k in m[1]) this.setParam(k, m[1][k]); break;
      case 'bend': this.bendV = m[1]; this.tg.bend = m[1]; break;
      case 'mw': this.mwV = m[1]; this.tg.mw = m[1]; break;
      case 'sus': this.setSustain(m[1]); break;
      case 'panic': this.panic(); break;
      case 'loopArm': this.loopArm(m[1], m[2], m[3], m[4]); break;
      case 'buf': this.loop.spare.push({ L: m[1], R: m[2] }); break;
      case 'loopRec': this.loopRec(); break;
      case 'loopPlay': this.loopPlay(); break;
      case 'loopUndo': this.loopUndo(); break;
      case 'loopClear': this.loopClear(); break;
      case 'loopMute': { const ly = this.loop.layers[m[1]]; if (ly) { ly.mute = !!m[2]; this.loopInfo(); } break; }
      case 'loopVol': this.loop.vol = m[1]; break;
      case 'metro': this.loop.metro = !!m[1]; break;
      case 'lat': this.loop.lat = Math.max(0, m[1] | 0); break;
      case 'loopExport': if (this.loop.len && m[1].length === this.loop.len) this.loop.exp = { L: m[1], R: m[2], off: 0 }; break;
    }
  }

  // ───────────── Looper ─────────────
  loopInfo() {
    const lp = this.loop;
    this.port.postMessage(['lp', {
      st: lp.st, len: lp.len, beats: lp.beats, bpm: lp.bpm, pos: lp.pos, frame: currentFrame,
      layers: lp.layers.map(l => l.mute), cur: lp.recOn ? lp.layers.indexOf(lp.cur) : -1,
    }]);
  }
  countIn() { const lp = this.loop; lp.pos = -Math.round(4 * lp.beatLen); lp.lastBeat = null; lp.st = 1; }
  loopArm(beats, bpm, len, bufs) {
    const lp = this.loop;
    if (lp.st !== 0) return;
    Object.assign(lp, { beats, bpm, len, beatLen: len / beats, layers: [], cur: null, recOn: false, recG: 0, dubAfter: false });
    lp.spare = bufs.map(([L, R]) => ({ L, R }));
    this.countIn();
    this.dirty = true;
    this.loopInfo();
  }
  newLayer() {
    const lp = this.loop;
    const b = lp.spare.shift();
    if (!b || lp.layers.length >= 12) { this.port.postMessage(['loopErr', b ? 'max' : 'mem']); if (b) lp.spare.unshift(b); return false; }
    const ly = { L: b.L, R: b.R, mute: false };
    lp.layers.push(ly);
    lp.cur = ly; lp.recOn = true; lp.recG = 0;
    this.port.postMessage(['needBuf']);
    return true;
  }
  loopRec() {
    const lp = this.loop;
    switch (lp.st) {
      case 3: if (this.newLayer()) lp.st = 4; break;
      case 4: lp.recOn = false; lp.st = 3; break;
      case 5: lp.dubAfter = true; this.countIn(); break;
      case 1: if (lp.layers.length) lp.st = 5; else return this.loopClear(); break;
      default: return;
    }
    this.loopInfo();
  }
  loopPlay() {
    const lp = this.loop;
    if (lp.st === 3 || lp.st === 4) { lp.recOn = false; lp.cur = null; lp.recG = 0; lp.st = 5; lp.pos = 0; }
    else if (lp.st === 5) { lp.st = 3; lp.pos = 0; lp.lastBeat = null; }
    else if (lp.st === 1) return this.loopRec();
    else return;
    this.loopInfo();
  }
  loopUndo() {
    const lp = this.loop;
    if (lp.st === 2 || (lp.st === 1 && !lp.layers.length)) return this.loopClear();
    if (lp.st === 1) { lp.st = 5; return this.loopInfo(); }
    const ly = lp.layers.pop();
    if (!ly) return;
    if (ly === lp.cur) { lp.cur = null; lp.recOn = false; lp.recG = 0; if (lp.st === 4) lp.st = 3; }
    this.port.postMessage(['ret', ly.L, ly.R], [ly.L.buffer, ly.R.buffer]);
    if (!lp.layers.length) this.loopClear(); else this.loopInfo();
  }
  loopClear() {
    const lp = this.loop;
    for (const b of [...lp.layers, ...lp.spare]) this.port.postMessage(['ret', b.L, b.R], [b.L.buffer, b.R.buffer]);
    Object.assign(lp, { layers: [], spare: [], cur: null, recOn: false, recG: 0, st: 0, len: 0, pos: 0, exp: null });
    this.dirty = true;
    this.loopInfo();
  }

  setParam(id, v) {
    const old = this.P[id];
    this.P[id] = v;
    this.dirty = true;
    if (old === v) return;
    if (id === 'vMode') { this.releaseAll(); this.stack = []; }
    else if (id === 'arpOn') {
      if (v > 0.5) {
        for (const d of this.down) this.stop(d.n);
        this.held = this.down.map(d => ({ n: d.n, vel: d.vel }));
        if (this.held.length) this.arpStart();
      } else {
        this.arpStop(); this.held = [];
        for (const d of this.down) this.play(d.n, d.vel);
      }
    } else if (id === 'arpLatch' && v < 0.5 && this.P.arpOn > 0.5) {
      this.held = this.down.map(d => ({ n: d.n, vel: d.vel }));
      if (!this.held.length) this.arpStop();
    }
  }

  derive() {
    const P = this.P, sr = sampleRate;
    this.dirty = false;
    const atk = t => 1 - Math.exp(-1.466 / (Math.max(t, 0.0005) * sr));
    const dec = t => Math.exp(-4.6 / (Math.max(t, 0.0005) * sr));
    this.aAtk = atk(P.aA); this.aDec = dec(P.aD); this.aRel = dec(P.aR);
    this.fAtk = atk(P.fA); this.fDec = dec(P.fD); this.fRel = dec(P.fR);
    this.r1 = Math.pow(2, P.o1Oct + P.o1Semi / 12 + P.o1Fine / 1200);
    this.r2 = Math.pow(2, P.o2Oct + P.o2Semi / 12 + P.o2Fine / 1200);
    const U = this.U = Math.max(1, Math.min(MAXU, P.uniN | 0));
    this.uniR = new Float64Array(U);
    for (let u = 0; u < U; u++) {
      const c = U === 1 ? 0 : (u / (U - 1) - 0.5) * 2 * P.uniDet;
      this.uniR[u] = Math.pow(2, c / 1200);
    }
    this.uniG = 1 / Math.sqrt(U);
    this.glideK = P.glide > 0.001 ? 1 - Math.exp(-1 / (P.glide * 0.3 * sr)) : 1;
    const t = this.tg;
    t.cut = Math.log2(P.cutoff); t.res = P.reso * 4.2;
    t.o1Lvl = P.o1Lvl; t.o2Lvl = P.o2Lvl; t.subLvl = P.subLvl; t.noiseLvl = P.noiseLvl;
    t.pw = P.pw; t.fm = P.fm; t.drive = Math.pow(2, P.fDrive * 4); t.master = P.master;
    t.bend = this.bendV; t.mw = this.mwV;
    // Quand une boucle existe, l'arpège est verrouillé sur son tempo exact.
    const div = ARP_DIVS[P.arpDiv | 0];
    this.arpLen = this.loop.len ? this.loop.beatLen / div : sr * 60 / P.bpm / div;
    this.dTarget = Math.min(P.dTime * sr, this.dSize - 4);
    const dg = 1 + P.dist * P.dist * 40;
    this.distG = dg; this.distN = 0.5 / tanh(0.5 * dg);
    this.rFb = 0.7 + P.rSize * 0.28; this.rD1 = P.rDamp * 0.4; this.rD2 = 1 - this.rD1;
  }

  // ───────────── Gestion des notes ─────────────
  noteOn(n, vel) {
    this.down = this.down.filter(d => d.n !== n);
    this.down.push({ n, vel });
    if (this.P.arpOn > 0.5) {
      if (this.P.arpLatch > 0.5 && this.down.length === 1) this.held = [];
      if (!this.held.some(h => h.n === n)) this.held.push({ n, vel });
      if (!this.arpRun) this.arpStart();
    } else this.play(n, vel);
  }

  noteOff(n) {
    this.down = this.down.filter(d => d.n !== n);
    if (this.P.arpOn > 0.5) {
      if (this.P.arpLatch < 0.5) {
        this.held = this.held.filter(h => h.n !== n);
        if (!this.held.length) this.arpStop();
      }
    } else this.stop(n);
  }

  trigger(v, n, vel) {
    v.note = n; v.target = n; v.vel = vel;
    v.gate = true; v.sus = false; v.as = 1; v.fs = 1;
    v.age = ++this.ageCounter;
  }

  play(n, vel) {
    const P = this.P;
    if (P.vMode >= 1) {
      const v = this.voices[0];
      const i = this.stack.indexOf(n); if (i >= 0) this.stack.splice(i, 1);
      this.stack.push(n);
      const legato = P.vMode === 2 && v.gate && v.as !== 0;
      if (legato) { v.note = n; v.target = n; v.sus = false; }
      else {
        const wasIdle = v.as === 0;
        this.trigger(v, n, vel);
        if (wasIdle || P.vMode === 2 || this.glideK >= 1) v.cur = n;
      }
      this.lastNote = n;
      return;
    }
    let v = null;
    for (const x of this.voices) if (x.as !== 0 && x.note === n) { v = x; break; }
    if (!v) for (const x of this.voices) if (x.as === 0) { v = x; v.cur = this.glideK < 1 ? this.lastNote : n; break; }
    if (!v) { // vol de voix : d'abord celles en release (la plus faible), sinon la plus ancienne
      let best = null;
      for (const x of this.voices) if (!x.gate && (!best || x.ae < best.ae)) best = x;
      if (!best) for (const x of this.voices) if (!best || x.age < best.age) best = x;
      v = best;
    }
    this.trigger(v, n, vel);
    if (this.glideK >= 1) v.cur = n;
    this.lastNote = n;
  }

  stop(n) {
    if (this.P.vMode >= 1) {
      const v = this.voices[0];
      const i = this.stack.indexOf(n); if (i < 0) return;
      this.stack.splice(i, 1);
      if (this.stack.length) {
        const m = this.stack[this.stack.length - 1];
        v.note = m; v.target = m;
      } else if (this.sustain) v.sus = true;
      else this.release(v);
      return;
    }
    for (const v of this.voices) {
      if (v.note === n && v.gate && !v.sus) {
        if (this.sustain) v.sus = true; else this.release(v);
      }
    }
  }

  release(v) { v.gate = false; v.sus = false; if (v.as !== 0) { v.as = 4; v.fs = 4; } }
  releaseAll() { for (const v of this.voices) this.release(v); }

  setSustain(on) {
    this.sustain = on;
    if (!on) for (const v of this.voices) if (v.sus) this.release(v);
  }

  panic() {
    for (const v of this.voices) { v.as = 0; v.ae = 0; v.fs = 0; v.fe = 0; v.gate = false; v.sus = false; v.s1 = v.s2 = v.s3 = v.s4 = 0; }
    this.stack = []; this.down = []; this.held = []; this.arpRun = false; this.arpNote = -1; this.sustain = false;
  }

  // ───────────── Arpégiateur ─────────────
  arpStart() {
    this.arpRun = true; this.arpIdx = 0; this.arpStepIn = 0; this.arpOffIn = Infinity; this.arpGrid = 0;
    const lp = this.loop;
    if (lp.st >= 1 && lp.st <= 4) { // calé sur la grille de la boucle
      if (this.dirty) this.derive();
      const s = this.arpLen, p = ((lp.pos % s) + s) % s;
      this.arpStepIn = p < 0.04 * sampleRate ? -p : s - p;
      this.arpGrid = Math.round((lp.pos + Math.max(0, this.arpStepIn)) / s);
    }
  }
  arpStop() {
    this.arpRun = false; this.arpOffIn = Infinity;
    if (this.arpNote >= 0) { this.stop(this.arpNote); this.arpNote = -1; }
  }
  arpSeq() {
    const P = this.P, mode = P.arpMode | 0;
    if (!this.held.length) return [];
    const base = mode === 4 ? this.held.slice() : this.held.slice().sort((a, b) => a.n - b.n);
    let seq = [];
    for (let o = 0; o < (P.arpOct | 0); o++) for (const h of base) if (h.n + 12 * o <= 127) seq.push({ n: h.n + 12 * o, vel: h.vel });
    if (mode === 1) seq.reverse();
    else if (mode === 2 && seq.length > 2) seq = seq.concat(seq.slice(1, -1).reverse());
    return seq;
  }
  arpStep() {
    const P = this.P;
    const seq = this.arpSeq();
    if (!seq.length) { this.arpStop(); return; }
    const it = (P.arpMode | 0) === 3 ? seq[Math.floor(Math.random() * seq.length)] : seq[this.arpIdx % seq.length];
    this.arpIdx++;
    const prev = this.arpNote;
    this.play(it.n, it.vel);
    if (prev >= 0 && prev !== it.n) this.stop(prev);
    this.arpNote = it.n;
    const len = this.arpLen * (this.arpGrid++ % 2 === 0 ? 1 + P.arpSwing : 1 - P.arpSwing);
    this.arpStepIn += len;
    this.arpOffIn = P.arpGate >= 0.98 ? Infinity : len * P.arpGate;
  }

  // ───────────── Rendu ─────────────
  process(_, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const N = L.length;
    if (this.dirty) this.derive();
    const P = this.P, sr = sampleRate;

    // Paramètres lissés (anti-zipper) + LFO globaux, pour tout le bloc
    const k = this.smK;
    for (const key of SMOOTHED) {
      const a = this.A[key], t = this.tg[key];
      let c = this.sm[key];
      if (Math.abs(t - c) < 1e-5) { c = t; a.fill(t, 0, N); }
      else for (let i = 0; i < N; i++) { c += (t - c) * k; a[i] = c; }
      this.sm[key] = c;
    }
    this.fillLfo(this.lfo1, P.l1Shape | 0, P.l1Rate / sr, 1, N);
    this.fillLfo(this.lfo2, P.l2Shape | 0, P.l2Rate / sr, 2, N);
    this.bus.fill(0, 0, N);

    // Rendu des voix découpé aux évènements de l'arpégiateur (précision à l'échantillon)
    let pos = 0;
    for (;;) {
      if (this.arpRun) {
        if (this.arpOffIn <= 0) { this.arpOffIn = Infinity; if (this.arpNote >= 0) { this.stop(this.arpNote); this.arpNote = -1; } }
        if (this.arpStepIn <= 0) this.arpStep();
      }
      if (pos >= N) break;
      let len = N - pos;
      if (this.arpRun) {
        const e = Math.min(this.arpStepIn, this.arpOffIn);
        if (e < len) len = Math.max(1, Math.ceil(e));
      }
      this.renderVoices(pos, pos + len);
      if (this.arpRun) { this.arpStepIn -= len; this.arpOffIn -= len; }
      pos += len;
    }

    this.renderFx(L, R, N);

    // Export WAV : mixage des couches par tranches pour ne jamais surcharger un bloc audio
    const lp = this.loop;
    if (lp.exp) {
      const e = lp.exp, end = Math.min(e.off + 16384, lp.len);
      for (const ly of lp.layers) if (!ly.mute) for (let i = e.off; i < end; i++) { e.L[i] += ly.L[i]; e.R[i] += ly.R[i]; }
      e.off = end;
      if (end >= lp.len) { this.port.postMessage(['loopData', e.L, e.R, lp.bpm, lp.beats, lp.vol], [e.L.buffer, e.R.buffer]); lp.exp = null; }
    }

    if (++this.statCount >= 8) {
      this.statCount = 0;
      let n = 0; for (const v of this.voices) if (v.as !== 0) n++;
      this.port.postMessage(['st', n, this.arpRun ? this.arpIdx : -1, lp.pos, currentFrame + N]);
    }
    return true;
  }

  fillLfo(arr, shape, inc, which, N) {
    let p = which === 1 ? this.lp1 : this.lp2;
    let sh = which === 1 ? this.sh1 : this.sh2;
    for (let i = 0; i < N; i++) {
      p += inc;
      if (p >= 1) { p -= 1; sh = Math.random() * 2 - 1; }
      switch (shape) {
        case 0: arr[i] = Math.sin(TWO_PI * p); break;
        case 1: arr[i] = 1 - 4 * Math.abs(p - 0.5); break;
        case 2: arr[i] = 2 * p - 1; break;
        case 3: arr[i] = p < 0.5 ? 1 : -1; break;
        default: arr[i] = sh;
      }
    }
    if (which === 1) { this.lp1 = p; this.sh1 = sh; } else { this.lp2 = p; this.sh2 = sh; }
  }

  renderVoices(a, b) {
    const P = this.P, A = this.A, sr = sampleRate, invSr = 1 / sr;
    const lfo1 = this.lfo1, lfo2 = this.lfo2, bus = this.bus;
    const cutA = A.cut, resA = A.res, l1A = A.o1Lvl, l2A = A.o2Lvl, lsA = A.subLvl, lnA = A.noiseLvl;
    const pwA = A.pw, fmA = A.fm, drA = A.drive, bendA = A.bend, mwA = A.mw;
    const w1 = P.o1Wave, w2 = P.o2Wave, sync = P.sync > 0.5, U = this.U, uniR = this.uniR, uniG = this.uniG;
    const r1 = this.r1, r2 = this.r2, bendR = P.bendRange, vib = P.l1Pitch, mwVib = P.mwVib, o2Env = P.o2Env;
    const fEnvO = P.fEnv * 7, fKey = P.fKey, fVel = P.fVel, l1Cut = P.l1Cut * 4, mwCut = P.mwCut * 4;
    const l2Pw = P.l2Pw * 0.45, l2Amp = P.l2Amp, mode = P.fType | 0, velAmp = P.velAmp;
    const aAtk = this.aAtk, aDec = this.aDec, aRel = this.aRel, aSus = P.aS;
    const fAtk = this.fAtk, fDec = this.fDec, fRel = this.fRel, fSus = P.fS;
    const glideK = this.glideK;
    const fcMax = Math.min(20000, sr * 0.45);

    for (const v of this.voices) {
      if (v.as === 0) continue;
      const keyO = fKey * (v.note - 60) / 12;
      const velO = fVel * 4 * (v.vel - 1);
      const velG = (1 - velAmp + velAmp * v.vel) * 0.32;
      const p1 = v.p1, p2 = v.p2, o2l = v.o2l, target = v.target;
      let cur = v.cur, ps = v.ps, s1 = v.s1, s2 = v.s2, s3 = v.s3, s4 = v.s4;
      let ae = v.ae, as = v.as, fe = v.fe, fs = v.fs;

      for (let i = a; i < b; i++) {
        // Enveloppes
        if (as === 1) { ae += (1.3 - ae) * aAtk; if (ae >= 1) { ae = 1; as = 2; } }
        else if (as === 2) { ae = aSus + (ae - aSus) * aDec; if (aSus < 1e-4 && ae < 1e-4) { ae = 0; as = 0; } }
        else if (as === 4) { ae *= aRel; if (ae < 1e-4) { ae = 0; as = 0; } }
        if (fs === 1) { fe += (1.3 - fe) * fAtk; if (fe >= 1) { fe = 1; fs = 2; } }
        else if (fs === 2) fe = fSus + (fe - fSus) * fDec;
        else if (fs === 4) fe *= fRel;

        // Pitch
        cur += (target - cur) * glideK;
        const pitch = cur + bendA[i] * bendR + lfo1[i] * (vib + mwA[i] * mwVib) - 69;
        const dtB = 440 * Math.pow(2, pitch / 12) * invSr;
        const d1b = dtB * r1;
        const d2b = o2Env > 0 ? dtB * r2 * Math.pow(2, fe * o2Env / 12) : dtB * r2;
        let pw = pwA[i] + lfo2[i] * l2Pw;
        if (pw < 0.03) pw = 0.03; else if (pw > 0.97) pw = 0.97;
        const fm = fmA[i];

        // Oscillateurs (+ unisson)
        let so1 = 0, so2 = 0;
        for (let u = 0; u < U; u++) {
          const ur = uniR[u];
          let d1 = d1b * ur;
          if (fm > 0.0005) d1 *= Math.pow(2, fm * 3 * o2l[u]);
          if (d1 > 0.45) d1 = 0.45;
          let p = p1[u] + d1, wr = false;
          if (p >= 1) { p -= 1; wr = true; }
          p1[u] = p;
          so1 += osc(w1, p, d1, pw);
          let d2 = d2b * ur; if (d2 > 0.45) d2 = 0.45;
          let q = p2[u] + d2;
          if (q >= 1) q -= 1;
          if (sync && wr) { q = p * d2 / d1; q -= Math.floor(q); }
          p2[u] = q;
          const o = osc(w2, q, d2, pw);
          o2l[u] = o; so2 += o;
        }
        const ds = d1b * 0.5;
        ps += ds; if (ps >= 1) ps -= 1;
        const sub = (ps < 0.5 ? 1 : -1) + blep(ps, ds) - blep(ps < 0.5 ? ps + 0.5 : ps - 0.5, ds);
        let x = (so1 * l1A[i] + so2 * l2A[i]) * uniG + sub * lsA[i];
        if (lnA[i] > 0) x += (Math.random() * 2 - 1) * lnA[i];

        // Filtre ladder 4 pôles TPT avec saturation
        let fc = Math.pow(2, cutA[i] + fe * fEnvO + keyO + velO + lfo1[i] * l1Cut + mwA[i] * mwCut);
        if (fc > fcMax) fc = fcMax; else if (fc < 15) fc = 15;
        const g = Math.tan(Math.PI * fc * invSr);
        const G = g / (1 + g), B = 1 - G;
        const G2 = G * G, G3 = G2 * G, G4 = G3 * G;
        const kk = resA[i];
        const xin = x * 0.5 * drA[i] * (1 + kk * 0.4);
        const S = G3 * B * s1 + G2 * B * s2 + G * B * s3 + B * s4;
        const y4e = (G4 * xin + S) / (1 + kk * G4);
        const u0 = tanh(xin - kk * y4e);
        let t = (u0 - s1) * G; const y1 = t + s1; s1 = y1 + t;
        t = (y1 - s2) * G; const y2 = t + s2; s2 = y2 + t;
        t = (y2 - s3) * G; const y3 = t + s3; s3 = y3 + t;
        t = (y3 - s4) * G; const y4 = t + s4; s4 = y4 + t;
        let y;
        switch (mode) {
          case 0: y = y4; break;
          case 1: y = y2; break;
          case 2: y = 2 * (y1 - y2); break;
          default: y = u0 - 2 * y1 + y2;
        }
        bus[i] += y * ae * velG * (1 - l2Amp * (0.5 - 0.5 * lfo2[i]));
        if (as === 0) break;
      }
      v.cur = cur; v.ps = ps; v.s1 = s1; v.s2 = s2; v.s3 = s3; v.s4 = s4;
      v.ae = ae; v.as = as; v.fe = fe; v.fs = fs;
      if (as === 0) { v.gate = false; v.sus = false; v.s1 = v.s2 = v.s3 = v.s4 = 0; }
    }
  }

  renderFx(L, R, N) {
    const P = this.P, bus = this.bus, master = this.A.master;
    const dist = P.dist > 0.001, dg = this.distG, dn = this.distN;
    const ch = P.chorus, cBuf = this.cBuf, cMask = this.cSize - 1, sr = sampleRate;
    const cInc = 0.6 / sr, cBase = 0.012 * sr, cDep = 0.0035 * sr;
    const dL = this.dL, dR = this.dR, dMask = this.dSize - 1, dFb = P.dFb, dMix = P.dMix, dampK = this.dampK;
    const rMix = P.rMix, rFb = this.rFb, rD1 = this.rD1, rD2 = this.rD2;
    const cbL = this.cbL, cbR = this.cbR, apL = this.apL, apR = this.apR;
    const ciL = this.ciL, ciR = this.ciR, aiL = this.aiL, aiR = this.aiR, cfL = this.cfL, cfR = this.cfR;
    let cW = this.cW, cPh = this.cPh, dW = this.dW, dS = this.dS, dfL = this.dfL, dfR = this.dfR;
    const dT = this.dTarget;
    const lp = this.loop, rInc = this.rInc, cDec = this.cDec;

    for (let i = 0; i < N; i++) {
      let x = bus[i];
      if (dist) x = tanh(x * dg) * dn;

      // Chorus stéréo
      let l = x, r = x;
      cBuf[cW] = x;
      if (ch > 0.001) {
        cPh += cInc; if (cPh >= 1) cPh -= 1;
        const s = Math.sin(TWO_PI * cPh), c = Math.cos(TWO_PI * cPh);
        l = x + ch * 0.8 * (rd(cBuf, cMask, cW, cBase + cDep * s) - x * 0.3);
        r = x + ch * 0.8 * (rd(cBuf, cMask, cW, cBase + cDep * c) - x * 0.3);
      }
      cW = (cW + 1) & cMask;

      // Delay ping-pong
      dS += (dT - dS) * 0.0004;
      const yl = rd(dL, dMask, dW, dS), yr = rd(dR, dMask, dW, dS);
      dfL += (yl - dfL) * dampK; dfR += (yr - dfR) * dampK;
      dL[dW] = (l + r) * 0.5 + dfR * dFb;
      dR[dW] = dfL * dFb;
      dW = (dW + 1) & dMask;
      l += yl * dMix; r += yr * dMix;

      // Reverb Freeverb
      if (rMix > 0.001) {
        const inp = (l + r) * 0.015;
        let oL = 0, oR = 0;
        for (let j = 0; j < 8; j++) {
          let bf = cbL[j], ix = ciL[j], y = bf[ix];
          cfL[j] = y * rD2 + cfL[j] * rD1; bf[ix] = inp + cfL[j] * rFb; if (++ix >= bf.length) ix = 0; ciL[j] = ix; oL += y;
          bf = cbR[j]; ix = ciR[j]; y = bf[ix];
          cfR[j] = y * rD2 + cfR[j] * rD1; bf[ix] = inp + cfR[j] * rFb; if (++ix >= bf.length) ix = 0; ciR[j] = ix; oR += y;
        }
        for (let j = 0; j < 4; j++) {
          let bf = apL[j], ix = aiL[j], bo = bf[ix];
          bf[ix] = oL + bo * 0.5; oL = bo - oL; if (++ix >= bf.length) ix = 0; aiL[j] = ix;
          bf = apR[j]; ix = aiR[j]; bo = bf[ix];
          bf[ix] = oR + bo * 0.5; oR = bo - oR; if (++ix >= bf.length) ix = 0; aiR[j] = ix;
        }
        l = l * (1 - rMix * 0.4) + oL * rMix * 2.5;
        r = r * (1 - rMix * 0.4) + oR * rMix * 2.5;
      }

      const m = master[i];
      let ol = l * m, orr = r * m;

      // Looper : enregistrement (compensé de la latence de sortie) + lecture des couches + métronome
      if (lp.st !== 0) {
        const pos = lp.pos;
        if (pos >= 0) {
          const cur = lp.cur;
          if (cur && (lp.recOn || lp.recG > 0)) {
            lp.recG = lp.recOn ? Math.min(1, lp.recG + rInc) : lp.recG - rInc;
            if (lp.recG > 0) {
              let w = pos - lp.lat; if (w < 0) w += lp.len;
              cur.L[w] += ol * lp.recG; cur.R[w] += orr * lp.recG;
            } else { lp.recG = 0; lp.cur = null; }
          }
          if (lp.st >= 2 && lp.st <= 4) {
            let sl = 0, sr2 = 0;
            const layers = lp.layers;
            for (let j = 0; j < layers.length; j++) { const ly = layers[j]; if (!ly.mute) { sl += ly.L[pos]; sr2 += ly.R[pos]; } }
            ol += sl * lp.vol; orr += sr2 * lp.vol;
          }
        }
        if (lp.st === 1 || (lp.metro && lp.st >= 2 && lp.st <= 4)) {
          const b = Math.floor(pos / lp.beatLen);
          if (b !== lp.lastBeat) { lp.lastBeat = b; lp.cEnv = 1; lp.cF = ((b % 4) + 4) % 4 === 0 ? 1760 : 1175; }
        }
        if (lp.st !== 5) {
          lp.pos = pos + 1;
          if (lp.pos === 0 && lp.st === 1) {
            const dub = lp.dubAfter || lp.layers.length > 0;
            lp.dubAfter = false;
            if (this.newLayer()) lp.st = dub ? 4 : 2; else lp.st = lp.layers.length ? 3 : 0;
            lp.lastBeat = null;
            this.loopInfo();
          } else if (lp.pos >= lp.len) {
            lp.pos = 0;
            if (lp.st === 2) { lp.recOn = false; lp.st = 3; this.loopInfo(); }
          }
        }
      }
      if (lp.cEnv > 0.0005) {
        lp.cPh += lp.cF / sr; if (lp.cPh >= 1) lp.cPh -= 1;
        const c = Math.sin(TWO_PI * lp.cPh) * lp.cEnv * 0.22;
        ol += c; orr += c;
        lp.cEnv *= cDec;
      }
      L[i] = tanh(ol);
      R[i] = tanh(orr);
    }
    this.cW = cW; this.cPh = cPh; this.dW = dW; this.dS = dS; this.dfL = dfL; this.dfR = dfR;
  }
}

registerProcessor('synth', SynthProcessor);
