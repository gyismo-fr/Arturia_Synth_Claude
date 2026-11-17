// Couche MIDI : entrée Web MIDI, mapping des contrôles physiques du MiniLab 3, MIDI Learn,
// détection automatique encodeurs absolus / relatifs.

const STORE_KEY = 'minisynth.midimap.v1';

// Contrôles physiques. kind : knob (encodeur de page), fader, enc (encodeur principal), btn, mom (momentané), pad
export const HW = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: 'k' + (i + 1), label: `Potard ${i + 1}`, kind: 'knob' })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: 'f' + (i + 1), label: `Fader ${i + 1}`, kind: 'fader' })),
  { id: 'enc', label: 'Encodeur principal (presets)', kind: 'enc' },
  { id: 'encClick', label: 'Clic encodeur (page suivante)', kind: 'btn' },
  { id: 'shift', label: 'Shift (réglage fin)', kind: 'mom' },
  { id: 'arp', label: 'Bouton Arpège on/off', kind: 'btn' },
  { id: 'latch', label: 'Bouton Hold (arpège)', kind: 'btn' },
  { id: 'loopRec', label: 'Looper : REC / overdub', kind: 'btn' },
  { id: 'loopPlay', label: 'Looper : lecture / stop', kind: 'btn' },
  { id: 'loopUndo', label: 'Looper : annuler la couche', kind: 'btn' },
  ...Array.from({ length: 8 }, (_, i) => ({ id: 'pa' + (i + 1), label: `Pad ${i + 1} · banque A (page)`, kind: 'pad' })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: 'pb' + (i + 1), label: `Pad ${i + 9} · banque B (accord)`, kind: 'pad' })),
];
export const HW_BY_ID = Object.fromEntries(HW.map(h => [h.id, h]));

// Mapping d'usine du MiniLab 3 (programme « Arturia » / User par défaut).
// Si ton MiniLab envoie autre chose, la calibration (MIDI Learn) corrige ça en 2 secondes.
export function defaultMap() {
  const m = [];
  [74, 71, 76, 77, 93, 18, 19, 16].forEach((n, i) => m.push({ hw: 'k' + (i + 1), t: 'cc', ch: -1, n, mode: 'abs' }));
  [82, 83, 85, 17].forEach((n, i) => m.push({ hw: 'f' + (i + 1), t: 'cc', ch: -1, n, mode: 'direct' }));
  m.push({ hw: 'enc', t: 'cc', ch: -1, n: 114, mode: 'rel' });
  m.push({ hw: 'enc', t: 'cc', ch: -1, n: 28, mode: 'rel' });
  m.push({ hw: 'encClick', t: 'cc', ch: -1, n: 115, mode: 'btn' });
  m.push({ hw: 'encClick', t: 'cc', ch: -1, n: 118, mode: 'btn' });
  for (let i = 0; i < 8; i++) {
    m.push({ hw: 'pa' + (i + 1), t: 'note', ch: 9, n: 36 + i, mode: 'btn' });
    m.push({ hw: 'pb' + (i + 1), t: 'note', ch: 9, n: 44 + i, mode: 'btn' });
  }
  return m;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

export function describe(e) {
  if (!e) return '—';
  const ch = e.ch < 0 ? 'tous canaux' : `canal ${e.ch + 1}`;
  return e.t === 'cc' ? `CC ${e.n} · ${ch}` : `Note ${e.n} (${noteName(e.n)}) · ${ch}`;
}

// Valeurs typiques d'un encodeur relatif (offset 64, ou complément à 2)
const relish = v => (v >= 1 && v <= 15) || (v >= 113 && v <= 126) || (v >= 56 && v <= 72);
export const relDelta = v => (v >= 56 && v <= 72 ? v - 64 : v < 56 ? v : v - 128);

export class Midi {
  constructor(h) {
    this.h = h;          // callbacks : noteOn, noteOff, bend, mod, sustain, allOff, hw, monitor, learned, changed, toast
    this.access = null;
    this.selected = 'auto';
    this.lastAbs = {};
    this.hist = {};
    this.learn = null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* ignore */ }
    this.map = Array.isArray(saved) ? saved : defaultMap();
    this.reindex();
  }

  async init() {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI non supporté par ce navigateur (utilise Chrome ou Edge).');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  inputs() { return this.access ? [...this.access.inputs.values()] : []; }

  activeInputs() {
    const all = this.inputs();
    if (this.selected === 'all') return all;
    if (this.selected !== 'auto') return all.filter(i => i.id === this.selected);
    const bad = /mcu|hui|daw|midiin\d|din/i;
    const mini = all.filter(i => /minilab/i.test(i.name) && !bad.test(i.name));
    return mini.length ? mini : all.filter(i => !bad.test(i.name));
  }

  refresh() {
    const act = new Set(this.activeInputs());
    for (const i of this.inputs()) i.onmidimessage = act.has(i) ? e => this.onMsg(e.data) : null;
    this.h.changed([...act].map(i => i.name));
  }

  select(id) { this.selected = id; this.lastAbs = {}; this.refresh(); }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.map)); } catch { /* ignore */ }
    this.reindex();
  }

  reset() { this.map = defaultMap(); this.lastAbs = {}; this.save(); }

  reindex() {
    this.idx = new Map();
    for (const e of this.map) this.idx.set(`${e.t}:${e.ch}:${e.n}`, e);
  }

  find(t, ch, n) { return this.idx.get(`${t}:${ch}:${n}`) || this.idx.get(`${t}:-1:${n}`); }

  entriesFor(hw) { return this.map.filter(e => e.hw === hw); }

  setMode(hw, mode) {
    for (const e of this.map) if (e.hw === hw) e.mode = mode;
    delete this.lastAbs[hw];
    this.save();
  }

  onMsg(d) {
    const s = d[0];
    if (s >= 0xF0) return; // SysEx, clock, active sensing…
    const st = s & 0xF0, ch = s & 0x0F, a = d[1], b = d[2];
    if (st === 0x90 && b > 0) return this.onNote(true, ch, a, b);
    if (st === 0x80 || st === 0x90) return this.onNote(false, ch, a, 0);
    if (st === 0xB0) return this.onCC(ch, a, b);
    if (st === 0xE0) {
      const v = ((b << 7) | a) - 8192;
      this.h.bend(Math.max(-1, v / 8191));
      this.h.monitor(`Pitch bend ${v}`);
    }
  }

  onNote(on, ch, n, vel) {
    if (this.learn) { if (on) this.learnMsg('note', ch, n, vel); return; }
    const e = this.find('note', ch, n);
    if (e) {
      this.h.hw(e.hw, { press: on, vel: vel / 127 });
      if (on) this.h.monitor(`Note ${noteName(n)} · canal ${ch + 1} → ${HW_BY_ID[e.hw].label}`);
      return;
    }
    if (on) { this.h.noteOn(n, vel / 127); this.h.monitor(`Note ${noteName(n)} · vélocité ${vel} · canal ${ch + 1}`); }
    else this.h.noteOff(n);
  }

  onCC(ch, n, v) {
    if (this.learn) return this.learnMsg('cc', ch, n, v);
    const e = this.find('cc', ch, n);
    if (!e) {
      if (n === 1) this.h.mod(v / 127);
      else if (n === 64) this.h.sustain(v >= 64);
      else if (n === 120 || n === 123) this.h.allOff();
      this.h.monitor(`CC ${n} = ${v} · canal ${ch + 1}${n === 1 ? ' → Modulation' : n === 64 ? ' → Sustain' : ' (non assigné)'}`);
      return;
    }
    const hw = HW_BY_ID[e.hw];
    let label = hw.label;
    if (hw.kind === 'knob') {
      this.autodetect(e, v);
      if (e.mode === 'rel') this.h.hw(e.hw, { rel: relDelta(v) });
      else {
        const old = this.lastAbs[e.hw];
        this.lastAbs[e.hw] = v;
        this.h.hw(e.hw, { abs: v, old });
      }
      label += e.mode === 'rel' ? ' (relatif)' : ' (absolu)';
    } else if (hw.kind === 'fader') this.h.hw(e.hw, { val: v / 127 });
    else if (hw.kind === 'enc') this.h.hw(e.hw, { rel: relDelta(v) });
    else this.h.hw(e.hw, { press: v > 0, vel: v / 127 });
    this.h.monitor(`CC ${n} = ${v} · canal ${ch + 1} → ${label}`);
  }

  // Bascule automatique absolu ↔ relatif selon ce que l'encodeur envoie réellement.
  autodetect(e, v) {
    const h = this.hist[e.hw] || (this.hist[e.hw] = { last: -1, rep: 0 });
    h.rep = v === h.last ? h.rep + 1 : 0;
    h.last = v;
    if (e.mode === 'abs' && h.rep >= 2 && relish(v)) {
      this.setMode(e.hw, 'rel');
      this.h.toast(`${HW_BY_ID[e.hw].label} : encodeur relatif détecté`);
    } else if (e.mode === 'rel' && !relish(v) && v !== 0 && v !== 127) {
      this.setMode(e.hw, 'abs');
      this.h.toast(`${HW_BY_ID[e.hw].label} : encodeur absolu détecté`);
    }
  }

  // ───── MIDI Learn ─────
  startLearn(hw) { this.cancelLearn(); this.learn = { hw, got: null, vals: [], timer: 0 }; }
  cancelLearn() { if (this.learn) clearTimeout(this.learn.timer); this.learn = null; }

  learnMsg(t, ch, n, v) {
    const L = this.learn, kind = HW_BY_ID[L.hw].kind;
    if (t === 'note') {
      if (kind === 'btn' || kind === 'mom' || kind === 'pad') this.assign({ t, ch, n, mode: 'btn' });
      return;
    }
    if (kind === 'knob') {
      if (!L.got) { L.got = { ch, n }; L.timer = setTimeout(() => this.finishKnob(), 500); }
      if (L.got.ch === ch && L.got.n === n) L.vals.push(v);
      return;
    }
    const mode = kind === 'fader' ? 'direct' : kind === 'enc' ? 'rel' : 'btn';
    this.assign({ t, ch, n, mode });
  }

  finishKnob() {
    const L = this.learn; if (!L) return;
    const vals = L.vals;
    let dup = false;
    for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) dup = true;
    const rel = vals.every(relish) && (dup || vals.length === 1 && (vals[0] === 1 || vals[0] === 65 || vals[0] === 63));
    if (!rel) this.lastAbs[L.hw] = vals[vals.length - 1];
    this.assign({ t: 'cc', ch: L.got.ch, n: L.got.n, mode: rel ? 'rel' : 'abs' });
  }

  assign(entry) {
    const hw = this.learn.hw;
    this.map = this.map.filter(e => e.hw !== hw && !(e.t === entry.t && e.n === entry.n && (e.ch === entry.ch || e.ch === -1)));
    this.map.push({ hw, ...entry });
    this.learn = null;
    this.save();
    this.h.learned(hw, entry);
  }
}
