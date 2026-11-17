import { PARAMS, PAGES, FADERS, toReal, toNorm, fmtValue, relStep } from './params.js';
import { FACTORY } from './presets.js';
import { Midi, HW, HW_BY_ID, describe, noteName } from './midi.js';

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

const IDS = Object.keys(PARAMS);
const PAGE_OF = {};
PAGES.forEach((p, i) => p.params.forEach(id => { PAGE_OF[id] = i; }));

const state = { n: {}, page: 0, preset: 0, modified: false, shift: false, kbOct: 4 };
for (const id of IDS) state.n[id] = toNorm(PARAMS[id], PARAMS[id].def);

let ctx = null, node = null, analyser = null, midi = null;
const stats = { voices: 0, arp: -1 };
const send = m => { if (node) node.port.postMessage(m); };
const realAll = () => Object.fromEntries(IDS.map(id => [id, toReal(PARAMS[id], state.n[id])]));

// ───────────────────────── Paramètres ─────────────────────────
const dirty = new Set();
let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set('minisynth.state', { params: realAll(), page: state.page, preset: state.preset, modified: state.modified }), 400);
}

function setParam(id, n) {
  n = Math.min(1, Math.max(0, n));
  const prev = state.n[id];
  if (prev === n) return;
  if (id === 'bpm' && loop.st !== 0) {
    if (performance.now() - loop.lockToast > 1500) { loop.lockToast = performance.now(); toast(`Tempo verrouillé sur la boucle (${loop.bpm} BPM) — efface-la pour le changer`); }
    return;
  }
  const spec = PARAMS[id];
  const oldReal = toReal(spec, prev);
  state.n[id] = n;
  const real = toReal(spec, n);
  if (real !== oldReal) {
    send(['p', id, real]);
    if (!state.modified) { state.modified = true; $('#modFlag').hidden = false; }
  }
  dirty.add(id);
  saveSoon();
}

// Ableton-like « value scaling » : un encodeur absolu ne fait jamais sauter la valeur au changement de page.
function valueScale(n, vOld, vNew) {
  if (vNew > vOld) return vOld >= 127 ? n : n + (vNew - vOld) * (1 - n) / (127 - vOld);
  if (vNew < vOld) return vOld <= 0 ? n : n - (vOld - vNew) * n / vOld;
  return n;
}

function applyEv(id, ev) {
  const spec = PARAMS[id];
  let n = state.n[id];
  if (ev.rel !== undefined) n += ev.rel * relStep(spec) * (state.shift ? 0.2 : 1);
  else if (ev.old !== undefined) n = valueScale(n, ev.old, ev.abs);
  setParam(id, n);
  hudParam(id);
}

const toggle = id => { setParam(id, state.n[id] >= 0.5 ? 0 : 1); hudParam(id); };

// ───────────────────────── Presets ─────────────────────────
let userPresets = store.get('minisynth.user', []);
const allPresets = () => [...FACTORY.map(p => ({ ...p, factory: true })), ...userPresets];

function loadPreset(i) {
  const list = allPresets();
  i = ((i % list.length) + list.length) % list.length;
  const p = list[i];
  for (const id of IDS) {
    if (id === 'bpm') continue; // le tempo est un réglage de jeu : changer de son ne le modifie pas
    const spec = PARAMS[id];
    state.n[id] = toNorm(spec, p.params[id] ?? spec.def);
    dirty.add(id);
  }
  state.preset = i;
  state.modified = false;
  $('#modFlag').hidden = true;
  send(['ps', realAll()]);
  renderPresetSel();
  hud('PRESET', p.name);
  saveSoon();
}

function renderPresetSel() {
  const sel = $('#presetSel');
  const list = allPresets();
  sel.innerHTML = '';
  const groups = [['Usine', list.filter(p => p.factory)], ['Mes presets', list.filter(p => !p.factory)]];
  let idx = 0;
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const p of items) {
      const o = document.createElement('option');
      o.value = idx++;
      o.textContent = p.name;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.value = state.preset;
  $('#delP').disabled = !!list[state.preset]?.factory;
}

function savePreset() {
  const cur = allPresets()[state.preset];
  const name = prompt('Nom du preset :', cur && !cur.factory ? cur.name : 'Mon son')?.trim();
  if (!name) return;
  const p = { name, params: realAll() };
  const ex = userPresets.findIndex(u => u.name === name);
  if (ex >= 0) userPresets[ex] = p; else userPresets.push(p);
  store.set('minisynth.user', userPresets);
  state.preset = FACTORY.length + userPresets.findIndex(u => u.name === name);
  state.modified = false;
  $('#modFlag').hidden = true;
  renderPresetSel();
  toast(`Preset « ${name} » enregistré`);
  saveSoon();
}

function deletePreset() {
  const list = allPresets();
  const p = list[state.preset];
  if (!p || p.factory || !confirm(`Supprimer le preset « ${p.name} » ?`)) return;
  userPresets = userPresets.filter(u => u !== list[state.preset] && u.name !== p.name);
  store.set('minisynth.user', userPresets);
  state.preset = 0;
  renderPresetSel();
  toast('Preset supprimé');
}

function exportPreset() {
  const cur = allPresets()[state.preset];
  const name = cur ? cur.name : 'preset';
  const blob = new Blob([JSON.stringify({ name, params: realAll() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w\- ]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importPresets(file) {
  try {
    const data = JSON.parse(await file.text());
    const arr = (Array.isArray(data) ? data : [data]).filter(p => p && typeof p.params === 'object');
    if (!arr.length) throw new Error('format');
    for (const p of arr) {
      const name = String(p.name || 'Import');
      const ex = userPresets.findIndex(u => u.name === name);
      const np = { name, params: p.params };
      if (ex >= 0) userPresets[ex] = np; else userPresets.push(np);
    }
    store.set('minisynth.user', userPresets);
    loadPreset(FACTORY.length + userPresets.findIndex(u => u.name === String(arr[arr.length - 1].name || 'Import')));
    toast(`${arr.length} preset(s) importé(s)`);
  } catch { toast('Fichier de preset invalide'); }
}

// ───────────────────────── Notes ─────────────────────────
const shown = new Map(); // note → nombre de sources qui la tiennent
function noteOn(n, vel) {
  send(['on', n, vel]);
  shown.set(n, (shown.get(n) || 0) + 1);
  keyEls[n]?.classList.add('down');
}
function noteOff(n) {
  send(['off', n]);
  const c = (shown.get(n) || 1) - 1;
  if (c <= 0) { shown.delete(n); keyEls[n]?.classList.remove('down'); } else shown.set(n, c);
}
function allOff() {
  send(['panic']);
  shown.clear();
  for (const el of Object.values(keyEls)) el.classList.remove('down');
  for (const k in padChords) delete padChords[k];
  pcDown.clear();
}

// Banque B des pads : accords diatoniques en Do majeur (I ii iii IV V vi vii° I')
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const padChords = {};
function chordOn(i, vel) {
  if (padChords[i]) return;
  const deg = i % 7, base = 48 + (i >= 7 ? 12 : 0);
  const notes = [0, 2, 4].map(s => { const d = deg + s; return base + SCALE[d % 7] + 12 * Math.floor(d / 7); });
  padChords[i] = notes;
  notes.forEach(n => noteOn(n, vel));
}
function chordOff(i) {
  const notes = padChords[i];
  if (!notes) return;
  delete padChords[i];
  notes.forEach(noteOff);
}

// ───────────────────────── Looper ─────────────────────────
const BEAT_CHOICES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const ST_LABEL = ['vide', 'décompte', 'rec', 'lecture', 'overdub', 'arrêt'];
const lpPrefs = Object.assign({ beats: 8, metro: true, vol: 0.8 }, store.get('minisynth.looper', {}));
const loop = { st: 0, len: 0, beats: lpPrefs.beats, bpm: 120, pos: 0, frame: 0, layers: [], cur: -1, lat: 0, lockToast: 0, armedLen: 0, cellsKey: '' };
const saveLp = () => store.set('minisynth.looper', lpPrefs);

const allocPair = len => [new Float32Array(len), new Float32Array(len)];

function loopRecPress() {
  if (!node) return;
  if (loop.st !== 0) { send(['loopRec']); return; }
  const bpm = toReal(PARAMS.bpm, state.n.bpm);
  const len = Math.round(lpPrefs.beats * 60 / bpm * ctx.sampleRate);
  if (len * 8 * 12 > 1.5e9) { toast('Boucle trop longue'); return; }
  loop.armedLen = len;
  const bufs = [allocPair(len), allocPair(len)];
  node.port.postMessage(['loopArm', lpPrefs.beats, bpm, len, bufs], bufs.flat().map(a => a.buffer));
}

function onLoopMsg(m) {
  switch (m[0]) {
    case 'lp':
      Object.assign(loop, m[1]);
      if (loop.st === 0) loop.beats = lpPrefs.beats;
      renderLooper();
      break;
    case 'needBuf': {
      const pair = allocPair(loop.armedLen);
      node.port.postMessage(['buf', ...pair], pair.map(a => a.buffer));
      break;
    }
    case 'loopErr': toast(m[1] === 'max' ? 'Maximum 12 couches — annule ou coupe une couche' : 'Mémoire tampon indisponible, réessaie'); break;
    case 'loopData': downloadWav(m[1], m[2], m[3], m[4], m[5]); break;
  }
}

function renderLooper() {
  const st = loop.st, empty = st === 0;
  $('#looper').dataset.st = ST_LABEL[st];
  $('#lpRec').classList.toggle('on', st === 1 || st === 2 || st === 4);
  $('#lpRec').textContent = st === 4 ? '● STOP DUB' : st === 3 || st === 5 ? '● OVERDUB' : '● REC';
  $('#lpPlay').textContent = st === 3 || st === 4 ? '■ Stop' : '▶ Lecture';
  $('#lpPlay').disabled = !(st >= 3);
  $('#lpUndo').disabled = empty;
  $('#lpClear').disabled = empty;
  $('#lpWav').disabled = !loop.layers.length;
  for (const id of ['#beatsMinus', '#beatsPlus', '#bpmMinus', '#bpmPlus']) $(id).disabled = !empty;
  const beats = empty ? lpPrefs.beats : loop.beats;
  $('#lpBeats').textContent = beats;
  $('#lpBars').textContent = beats % 4 === 0 ? `${beats / 4} mesure${beats > 4 ? 's' : ''}` : `${beats} temps`;
  $('#lpBpm').textContent = empty ? toReal(PARAMS.bpm, state.n.bpm) : loop.bpm;
  const key = `${beats}`;
  if (loop.cellsKey !== key) {
    loop.cellsKey = key;
    $('#lpCells').innerHTML = Array.from({ length: beats }, (_, i) => `<div class="cell${i % 4 === 0 ? ' bar' : ''}"></div>`).join('');
  }
  const lw = $('#lpLayers');
  lw.innerHTML = '';
  loop.layers.forEach((muted, i) => {
    const b = document.createElement('button');
    b.className = 'layer' + (muted ? ' muted' : '') + (i === loop.cur ? ' rec' : '');
    b.textContent = `${muted ? '🔇' : '🔊'} ${i === 0 ? 'Base' : 'Couche ' + (i + 1)}`;
    b.title = muted ? 'Réactiver cette couche' : 'Couper cette couche';
    b.addEventListener('click', () => send(['loopMute', i, !muted]));
    lw.appendChild(b);
  });
}

function loopPosNow() {
  if (!ctx || loop.st === 0) return 0;
  if (loop.st === 5) return loop.pos;
  const p = loop.pos + (ctx.currentTime * ctx.sampleRate - loop.frame) - loop.lat;
  return loop.st === 1 ? Math.min(p, 0) : ((p % loop.len) + loop.len) % loop.len;
}

let lastLpStatus = '', lastCell = -2;
function drawLooper() {
  const st = loop.st;
  const beatLen = loop.len / (loop.beats || 1);
  const p = loopPosNow();
  const beat = st === 0 ? -1 : Math.floor(p / beatLen);
  let txt;
  if (st === 0) txt = `Vide — choisis la longueur puis REC (touche R). Décompte d'une mesure au métronome.`;
  else if (st === 1) txt = `Décompte… ${-beat}`;
  else if (st === 2) txt = `● Enregistrement de la base — temps ${beat + 1} / ${loop.beats}`;
  else if (st === 4) txt = `● Overdub sur la couche ${loop.cur + 1} — REC pour arrêter · temps ${beat + 1} / ${loop.beats}`;
  else if (st === 3) txt = `▶ Lecture · ${loop.layers.length} couche${loop.layers.length > 1 ? 's' : ''} — REC pour ajouter une couche · temps ${beat + 1} / ${loop.beats}`;
  else txt = `■ Arrêtée — Espace pour relancer, REC pour enregistrer une couche (avec décompte)`;
  if (txt !== lastLpStatus) { lastLpStatus = txt; $('#lpStatus').textContent = txt; }
  $('#lpHead').style.transform = `translateX(${st >= 2 ? (p / loop.len) * 100 : 0}%)`;
  $('#lpHead').hidden = st < 2;
  if (beat !== lastCell) {
    lastCell = beat;
    const cells = $('#lpCells').children;
    for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('now', i === beat);
    if (st === 1) $('#lpCount').textContent = -beat; else $('#lpCount').textContent = '';
  }
}

function downloadWav(L, R, bpm, beats, vol) {
  const n = L.length, sr = ctx.sampleRate;
  const buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    dv.setInt16(o, Math.round(Math.tanh(L[i] * vol) * 32767), true);
    dv.setInt16(o + 2, Math.round(Math.tanh(R[i] * vol) * 32767), true);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  a.download = `boucle-${bpm}bpm-${beats}temps.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Boucle exportée en WAV (elle se répète parfaitement en lecture en boucle)');
}

function initLooperUi() {
  const stepBeats = d => {
    const i = BEAT_CHOICES.indexOf(lpPrefs.beats);
    lpPrefs.beats = BEAT_CHOICES[Math.max(0, Math.min(BEAT_CHOICES.length - 1, (i < 0 ? 5 : i) + d))];
    saveLp(); renderLooper();
  };
  const stepBpm = d => { setParam('bpm', toNorm(PARAMS.bpm, toReal(PARAMS.bpm, state.n.bpm) + d)); renderLooper(); };
  $('#beatsMinus').addEventListener('click', () => stepBeats(-1));
  $('#beatsPlus').addEventListener('click', () => stepBeats(1));
  $('#bpmMinus').addEventListener('click', e => stepBpm(e.shiftKey ? -10 : -1));
  $('#bpmPlus').addEventListener('click', e => stepBpm(e.shiftKey ? 10 : 1));
  $('#lpBpm').addEventListener('wheel', e => { e.preventDefault(); if (loop.st === 0) stepBpm(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  $('#lpRec').addEventListener('click', loopRecPress);
  $('#lpPlay').addEventListener('click', () => send(['loopPlay']));
  $('#lpUndo').addEventListener('click', () => send(['loopUndo']));
  $('#lpClear').addEventListener('click', () => { if (confirm('Effacer toute la boucle ?')) send(['loopClear']); });
  $('#lpWav').addEventListener('click', () => {
    const pair = allocPair(loop.len);
    node.port.postMessage(['loopExport', ...pair], pair.map(a => a.buffer));
  });
  const metro = $('#lpMetro');
  metro.checked = lpPrefs.metro;
  metro.addEventListener('change', () => { lpPrefs.metro = metro.checked; saveLp(); send(['metro', metro.checked]); });
  const vol = $('#lpVol');
  vol.value = lpPrefs.vol;
  vol.addEventListener('input', () => { lpPrefs.vol = +vol.value; saveLp(); send(['loopVol', lpPrefs.vol]); });
  renderLooper();
}

// ───────────────────────── Contrôles physiques ─────────────────────────
function onHw(hw, ev) {
  const kind = HW_BY_ID[hw].kind;
  if (kind === 'knob') {
    const i = +hw.slice(1) - 1;
    applyEv(PAGES[state.page].params[i], ev);
    flash(bigViews[i]?.el);
    return;
  }
  if (kind === 'fader') {
    const i = +hw.slice(1) - 1;
    setParam(FADERS[i], ev.val);
    hudParam(FADERS[i]);
    flash(faderEls[i]);
    return;
  }
  if (hw === 'enc') { if (ev.rel) loadPreset(state.preset + Math.sign(ev.rel)); return; }
  if (hw === 'shift') { state.shift = ev.press; return; }
  if (!ev.press) { if (hw.startsWith('pb')) chordOff(+hw.slice(2) - 1); return; }
  if (hw === 'loopRec') loopRecPress();
  else if (hw === 'loopPlay') send(['loopPlay']);
  else if (hw === 'loopUndo') send(['loopUndo']);
  else if (hw === 'encClick') setPage(state.page + 1);
  else if (hw === 'arp') toggle('arpOn');
  else if (hw === 'latch') toggle('arpLatch');
  else if (hw.startsWith('pa')) setPage(+hw.slice(2) - 1);
  else if (hw.startsWith('pb')) chordOn(+hw.slice(2) - 1, ev.vel || 0.8);
}

function flash(el) {
  if (!el) return;
  el.classList.add('touched');
  clearTimeout(el._ft);
  el._ft = setTimeout(() => el.classList.remove('touched'), 260);
}

// ───────────────────────── UI : knobs ─────────────────────────
const views = new Map(); // id → Set de vues {update(n)}
const addView = (id, v) => { if (!views.has(id)) views.set(id, new Set()); views.get(id).add(v); };
const ARC = 'M 23.13 76.87 A 38 38 0 1 1 76.87 76.87';

function makeKnob(id, big, slot) {
  const spec = PARAMS[id];
  const el = document.createElement('div');
  el.className = 'knob' + (big ? ' big' : '');
  el.innerHTML = `${slot ? `<span class="slot">${slot}</span>` : ''}
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path class="track" d="${ARC}" pathLength="100"/>
      <path class="val" d="${ARC}" pathLength="100"/>
      <circle class="cap" cx="50" cy="50" r="27"/>
      <line class="ptr" x1="50" y1="50" x2="50" y2="28"/>
    </svg>
    <div class="kname">${spec.name}</div><div class="kval"></div>`;
  el.title = `${spec.name} — glisser verticalement, molette, double-clic = défaut${spec.opts ? ', clic = valeur suivante' : ''}`;
  const val = el.querySelector('.val'), ptr = el.querySelector('.ptr'), txt = el.querySelector('.kval');
  const view = {
    el,
    update(n) {
      if (spec.bipolar) {
        const s = Math.min(n, 0.5), l = Math.abs(n - 0.5);
        val.setAttribute('stroke-dasharray', `0 ${s * 100} ${l * 100} 200`);
      } else val.setAttribute('stroke-dasharray', `${n * 100} 200`);
      ptr.setAttribute('transform', `rotate(${-135 + 270 * n} 50 50)`);
      txt.textContent = fmtValue(spec, n);
    },
  };
  view.update(state.n[id]);
  addView(id, view);

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    let y = e.clientY, moved = 0;
    const move = ev => {
      const dy = y - ev.clientY; y = ev.clientY;
      moved += Math.abs(dy);
      setParam(id, state.n[id] + dy / (ev.shiftKey ? 1200 : 220));
      hudParam(id);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (moved < 3 && spec.opts) {
        const cnt = spec.opts.length, idx = toReal(spec, state.n[id]);
        setParam(id, ((idx + 1) % cnt) / (cnt - 1));
        hudParam(id);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => { setParam(id, toNorm(spec, spec.def)); hudParam(id); });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    setParam(id, state.n[id] - Math.sign(e.deltaY) * relStep(spec) * (e.shiftKey ? 0.3 : 2));
    hudParam(id);
  }, { passive: false });
  return view;
}

let bigViews = [];
function buildBigKnobs() {
  for (const v of bigViews) for (const set of views.values()) set.delete(v);
  const wrap = $('#bigKnobs');
  wrap.innerHTML = '';
  bigViews = PAGES[state.page].params.map((id, i) => {
    const v = makeKnob(id, true, i + 1);
    wrap.appendChild(v.el);
    return v;
  });
}

const faderEls = [];
function buildFaders() {
  const wrap = $('#faders');
  FADERS.forEach((id, i) => {
    const spec = PARAMS[id];
    const el = document.createElement('div');
    el.className = 'fader';
    el.innerHTML = `<div class="fval"></div><div class="ftrack"><div class="ffill"></div><div class="fthumb"></div></div><div class="fname">${'ADSR'[i]}</div><span class="slot">F${i + 1}</span>`;
    const track = el.querySelector('.ftrack'), fill = el.querySelector('.ffill'), thumb = el.querySelector('.fthumb'), fv = el.querySelector('.fval');
    el.title = spec.name;
    addView(id, {
      update(n) {
        fill.style.height = `${n * 100}%`;
        thumb.style.bottom = `calc(${n * 100}% - 7px)`;
        fv.textContent = fmtValue(spec, n);
      },
    });
    const setFromY = y => {
      const r = track.getBoundingClientRect();
      setParam(id, 1 - (y - r.top) / r.height);
      hudParam(id);
    };
    track.addEventListener('pointerdown', e => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      setFromY(e.clientY);
      const move = ev => setFromY(ev.clientY);
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => setParam(id, toNorm(spec, spec.def)));
    wrap.appendChild(el);
    faderEls.push(el);
    for (const v of views.get(id)) v.update(state.n[id]);
  });
}

function buildTabsAndOverview() {
  const tabs = $('#tabs'), ov = $('#overview');
  PAGES.forEach((p, i) => {
    const t = document.createElement('button');
    t.className = 'tab';
    t.style.setProperty('--c', p.color);
    t.innerHTML = `<span class="padn">${i + 1}</span>${p.name}`;
    t.title = `Pad ${i + 1} (banque A)`;
    t.addEventListener('click', () => setPage(i));
    tabs.appendChild(t);

    const sec = document.createElement('div');
    sec.className = 'ov card';
    sec.style.setProperty('--c', p.color);
    sec.innerHTML = `<button class="ov-head"><span class="padn">${i + 1}</span>${p.name}</button><div class="ov-knobs"></div>`;
    sec.querySelector('.ov-head').addEventListener('click', () => setPage(i));
    const kw = sec.querySelector('.ov-knobs');
    p.params.forEach(id => kw.appendChild(makeKnob(id, false).el));
    ov.appendChild(sec);
  });
}

function setPage(i) {
  state.page = ((i % PAGES.length) + PAGES.length) % PAGES.length;
  const p = PAGES[state.page];
  document.documentElement.style.setProperty('--accent', p.color);
  $('#pageTitle').textContent = p.name;
  document.querySelectorAll('.tab').forEach((t, k) => t.classList.toggle('active', k === state.page));
  document.querySelectorAll('.ov').forEach((t, k) => t.classList.toggle('active', k === state.page));
  buildBigKnobs();
  hud('PAGE', `${state.page + 1} · ${p.name}`);
  saveSoon();
}

// ───────────────────────── HUD / toast ─────────────────────────
let hudTimer = 0;
function hud(title, value) {
  const el = $('#hud');
  el.innerHTML = `<div class="ht">${title}</div><div class="hv">${value}</div>`;
  el.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => el.classList.remove('show'), 1400);
}
function hudParam(id) {
  const spec = PARAMS[id];
  hud(`${PAGES[PAGE_OF[id]].name} · ${spec.name}`, fmtValue(spec, state.n[id]));
}
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ───────────────────────── Clavier ─────────────────────────
const keyEls = {};
const KB_LO = 36, KB_HI = 96;
function buildKeyboard() {
  const kb = $('#keyboard');
  const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
  const whites = [];
  for (let n = KB_LO; n <= KB_HI; n++) if (!isBlack(n)) whites.push(n);
  const W = 100 / whites.length;
  let mouseNote = -1;
  const press = n => { if (mouseNote === n) return; release(); mouseNote = n; noteOn(n, 0.8); };
  const release = () => { if (mouseNote >= 0) { noteOff(mouseNote); mouseNote = -1; } };
  for (let n = KB_LO; n <= KB_HI; n++) {
    const k = document.createElement('div');
    if (isBlack(n)) {
      k.className = 'key black';
      const wi = whites.findIndex(w => w > n);
      k.style.left = `${wi * W - W * 0.32}%`;
      k.style.width = `${W * 0.64}%`;
    } else {
      k.className = 'key white';
      k.style.left = `${whites.indexOf(n) * W}%`;
      k.style.width = `${W}%`;
      if (n % 12 === 0) k.innerHTML = `<span>${noteName(n)}</span>`;
    }
    k.addEventListener('pointerdown', e => { e.preventDefault(); press(n); });
    k.addEventListener('pointerenter', e => { if (e.buttons & 1) press(n); });
    keyEls[n] = k;
    kb.appendChild(k);
  }
  kb.addEventListener('pointerleave', release);
  window.addEventListener('pointerup', release);
}

// Clavier d'ordinateur (positions physiques : fonctionne en AZERTY comme en QWERTY)
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const pcDown = new Map();
window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.code === 'KeyZ') { state.kbOct = Math.max(1, state.kbOct - 1); hud('CLAVIER PC', `Octave ${state.kbOct}`); return; }
  if (e.code === 'KeyX') { state.kbOct = Math.min(7, state.kbOct + 1); hud('CLAVIER PC', `Octave ${state.kbOct}`); return; }
  if (e.code === 'Escape') { allOff(); return; }
  if (e.code === 'KeyR') { loopRecPress(); return; }
  if (e.code === 'Space') { e.preventDefault(); send(['loopPlay']); return; }
  if (e.code === 'Backspace') { e.preventDefault(); send(['loopUndo']); return; }
  const off = KEYMAP[e.code];
  if (off === undefined || pcDown.has(e.code)) return;
  e.preventDefault();
  const n = 12 * (state.kbOct + 1) + off;
  pcDown.set(e.code, n);
  noteOn(n, 0.8);
});
window.addEventListener('keyup', e => {
  const n = pcDown.get(e.code);
  if (n === undefined) return;
  pcDown.delete(e.code);
  noteOff(n);
});
window.addEventListener('blur', () => { for (const n of pcDown.values()) noteOff(n); pcDown.clear(); });

// ───────────────────────── Calibration ─────────────────────────
function renderCalib() {
  const tb = $('#calibRows');
  tb.innerHTML = '';
  for (const h of HW) {
    const entries = midi ? midi.entriesFor(h.id) : [];
    const tr = document.createElement('tr');
    const learning = midi?.learn?.hw === h.id;
    if (learning) tr.className = 'learning';
    const mode = entries[0]?.mode;
    tr.innerHTML = `<td>${h.label}</td><td class="msg">${entries.length ? entries.map(describe).join('<br>') : '<em>non assigné</em>'}</td>
      <td>${h.kind === 'knob' && entries.length ? `<button class="mini mode">${mode === 'rel' ? 'Relatif' : 'Absolu'}</button>` : ''}</td>
      <td><button class="mini learn">${learning ? 'Touche le contrôle…' : 'Apprendre'}</button></td>`;
    tr.querySelector('.learn').addEventListener('click', () => {
      if (!midi) return toast('MIDI non disponible');
      if (learning) midi.cancelLearn(); else midi.startLearn(h.id);
      renderCalib();
    });
    tr.querySelector('.mode')?.addEventListener('click', () => { midi.setMode(h.id, mode === 'rel' ? 'abs' : 'rel'); renderCalib(); });
    tb.appendChild(tr);
  }
  const sel = $('#midiIn');
  const cur = midi?.selected || 'auto';
  sel.innerHTML = `<option value="auto">Auto (MiniLab)</option><option value="all">Toutes les entrées</option>` +
    (midi ? midi.inputs().map(i => `<option value="${i.id}">${i.name}</option>`).join('') : '');
  sel.value = cur;
}

// ───────────────────────── Boucle d'affichage ─────────────────────────
let lastMon = '', monDirty = false, ledUntil = 0, lastVoices = -1;
const scopeBuf = new Float32Array(2048);
function frame(t) {
  for (const id of dirty) { const set = views.get(id); if (set) for (const v of set) v.update(state.n[id]); }
  if (dirty.has('arpOn')) document.querySelectorAll('.tab')[7].classList.toggle('lit', state.n.arpOn >= 0.5);
  if (dirty.has('bpm') && loop.st === 0) $('#lpBpm').textContent = toReal(PARAMS.bpm, state.n.bpm);
  dirty.clear();
  if (monDirty) { $('#monitor').textContent = lastMon; monDirty = false; }
  $('#midiLed').classList.toggle('on', t < ledUntil);
  if (stats.voices !== lastVoices) { lastVoices = stats.voices; $('#voiceChip').textContent = `${stats.voices} / 8 voix`; }
  drawScope();
  drawLooper();
  requestAnimationFrame(frame);
}

const scope = $('#scope');
const sctx = scope.getContext('2d');
new ResizeObserver(() => {
  const r = scope.getBoundingClientRect(), d = devicePixelRatio || 1;
  scope.width = Math.max(1, r.width * d); scope.height = Math.max(1, r.height * d);
}).observe(scope);

function drawScope() {
  const w = scope.width, h = scope.height;
  sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = 'rgba(255,255,255,0.06)';
  sctx.lineWidth = 1;
  sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();
  if (!analyser) return;
  analyser.getFloatTimeDomainData(scopeBuf);
  let s = 0;
  for (let i = 1; i < 1024; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { s = i; break; }
  const len = 1024;
  sctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  sctx.lineWidth = 2 * (devicePixelRatio || 1);
  sctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w, y = h / 2 - scopeBuf[s + i] * h * 0.45;
    if (i) sctx.lineTo(x, y); else sctx.moveTo(x, y);
  }
  sctx.stroke();
}

// ───────────────────────── Démarrage ─────────────────────────
async function startAudio() {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('synth-processor.js');
  node = new AudioWorkletNode(ctx, 'synth', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: { params: realAll() },
  });
  node.port.onmessage = e => {
    const m = e.data;
    if (m[0] === 'st') { stats.voices = m[1]; stats.arp = m[2]; loop.pos = m[3]; loop.frame = m[4]; }
    else onLoopMsg(m);
  };
  send(['metro', lpPrefs.metro]);
  send(['loopVol', lpPrefs.vol]);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(ctx.destination);
  node.connect(analyser);
  if (ctx.state !== 'running') await ctx.resume();
  const showLat = () => {
    const ms = ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
    loop.lat = Math.round(ms / 1000 * ctx.sampleRate);
    send(['lat', loop.lat]); // compensation : ce que tu joues « en rythme » est recalé dans la boucle
    $('#audioChip').textContent = `${ms ? ms.toFixed(1) : '—'} ms · ${(ctx.sampleRate / 1000).toFixed(1)} kHz`;
  };
  showLat();
  setInterval(showLat, 2000);
}

async function startMidi() {
  midi = new Midi({
    noteOn, noteOff,
    bend: v => send(['bend', v]),
    mod: v => send(['mw', v]),
    sustain: on => send(['sus', on]),
    allOff,
    hw: onHw,
    monitor: m => { lastMon = m; monDirty = true; ledUntil = performance.now() + 90; },
    learned: (hw, e) => { toast(`${HW_BY_ID[hw].label} ← ${describe(e)}${e.mode === 'rel' ? ' (relatif)' : ''}`); renderCalib(); },
    changed: names => { $('#midiName').textContent = names.length ? names.join(', ') : 'Aucun appareil MIDI'; if ($('#calib').open) renderCalib(); },
    toast,
  });
  try { await midi.init(); }
  catch (err) {
    $('#midiName').textContent = 'MIDI indisponible';
    toast(err.message || 'Accès MIDI refusé');
  }
}

function boot() {
  const saved = store.get('minisynth.state', null);
  if (saved?.params) {
    for (const id of IDS) if (saved.params[id] !== undefined) state.n[id] = toNorm(PARAMS[id], saved.params[id]);
    state.preset = Math.min(saved.preset || 0, allPresets().length - 1);
    state.modified = !!saved.modified;
  }
  $('#modFlag').hidden = !state.modified;
  buildTabsAndOverview();
  buildFaders();
  buildKeyboard();
  initLooperUi();
  // Après un clic, on rend le focus à la page pour que Espace / R pilotent le looper et pas le bouton.
  document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.closest('dialog')) b.blur(); });
  document.addEventListener('change', e => { if (e.target.matches('input[type=checkbox], input[type=range]')) e.target.blur(); });
  setPage(saved?.page || 0);
  renderPresetSel();
  dirty.add('arpOn');
  requestAnimationFrame(frame);

  $('#startBtn').addEventListener('click', async () => {
    $('#startBtn').disabled = true;
    try {
      await startAudio();
      await startMidi();
      $('#start').remove();
    } catch (err) {
      console.error(err);
      $('#startErr').textContent = `Erreur : ${err.message}. Lance le synthé via start.bat (http://localhost), pas en ouvrant le fichier directement.`;
      $('#startBtn').disabled = false;
    }
  });

  $('#presetSel').addEventListener('change', e => loadPreset(+e.target.value));
  $('#prevP').addEventListener('click', () => loadPreset(state.preset - 1));
  $('#nextP').addEventListener('click', () => loadPreset(state.preset + 1));
  $('#saveP').addEventListener('click', savePreset);
  $('#delP').addEventListener('click', deletePreset);
  $('#exportP').addEventListener('click', exportPreset);
  $('#importP').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importPresets(e.target.files[0]); e.target.value = ''; });
  $('#panicBtn').addEventListener('click', allOff);
  $('#calibBtn').addEventListener('click', () => { renderCalib(); $('#calib').showModal(); });
  $('#calibClose').addEventListener('click', () => $('#calib').close());
  $('#calib').addEventListener('close', () => midi?.cancelLearn());
  $('#calibReset').addEventListener('click', () => { if (midi && confirm('Revenir au mapping d\'usine du MiniLab 3 ?')) { midi.reset(); renderCalib(); } });
  $('#midiIn').addEventListener('change', e => { midi?.select(e.target.value); renderCalib(); });
}

boot();
