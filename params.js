// Définition de tous les paramètres du synthé + organisation en pages (1 page = 8 potards du MiniLab).
// Chaque paramètre est manipulé côté UI/MIDI en valeur normalisée n ∈ [0,1],
// convertie en valeur réelle (Hz, secondes, index…) avant d'être envoyée au moteur audio.

const WAVES = ['SIN', 'TRI', 'SAW', 'SQR'];
const pct = v => `${Math.round(v * 100)} %`;
const sec = v => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const hz = v => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)} kHz`);
const signed = (v, u = '') => `${v > 0 ? '+' : ''}${v}${u}`;
const wave = v => {
  const i = Math.min(2, Math.floor(v));
  const f = v - i;
  if (v >= 2.97) return 'SQR';
  if (f < 0.03) return WAVES[i];
  if (f > 0.97) return WAVES[i + 1];
  return `${WAVES[i]}›${WAVES[i + 1]} ${Math.round(f * 100)}%`;
};

// curve: 'lin' | 'exp' | 'sq'   (exp : min>0 ; sq : plus de finesse vers le bas)
export const PARAMS = {
  // ── OSC 1
  o1Wave:  { name: 'Forme',      min: 0, max: 3, def: 2, fmt: wave },
  o1Oct:   { name: 'Octave',     min: -3, max: 3, step: 1, def: 0, fmt: v => signed(v), bipolar: true },
  o1Semi:  { name: 'Demi-ton',   min: -12, max: 12, step: 1, def: 0, fmt: v => signed(v), bipolar: true },
  o1Fine:  { name: 'Fin',        min: -50, max: 50, step: 1, def: 0, fmt: v => signed(v, ' ct'), bipolar: true },
  pw:      { name: 'Larg. PW',   min: 0.05, max: 0.95, def: 0.5, fmt: pct },
  o1Lvl:   { name: 'Niveau',     min: 0, max: 1, def: 0.8, fmt: pct },
  uniN:    { name: 'Unisson',    min: 1, max: 4, step: 1, def: 1, fmt: v => (v === 1 ? 'Off' : `${v} voix`) },
  uniDet:  { name: 'Désacc. U',  min: 0, max: 50, def: 12, curve: 'sq', fmt: v => `${v.toFixed(1)} ct` },
  // ── OSC 2
  o2Wave:  { name: 'Forme',      min: 0, max: 3, def: 2, fmt: wave },
  o2Oct:   { name: 'Octave',     min: -3, max: 3, step: 1, def: 0, fmt: v => signed(v), bipolar: true },
  o2Semi:  { name: 'Demi-ton',   min: -12, max: 12, step: 1, def: 0, fmt: v => signed(v), bipolar: true },
  o2Fine:  { name: 'Fin',        min: -50, max: 50, step: 1, def: 7, fmt: v => signed(v, ' ct'), bipolar: true },
  o2Lvl:   { name: 'Niveau',     min: 0, max: 1, def: 0.6, fmt: pct },
  sync:    { name: 'Sync',       opts: ['Off', 'On'], def: 0 },
  fm:      { name: 'FM 2→1',     min: 0, max: 1, def: 0, curve: 'sq', fmt: pct },
  o2Env:   { name: 'Env→Pitch2', min: 0, max: 48, def: 0, curve: 'sq', fmt: v => `${v.toFixed(1)} st` },
  // ── VOIX / MIX
  subLvl:  { name: 'Sub osc',    min: 0, max: 1, def: 0, fmt: pct },
  noiseLvl:{ name: 'Bruit',      min: 0, max: 1, def: 0, curve: 'sq', fmt: pct },
  glide:   { name: 'Glide',      min: 0, max: 2, def: 0, curve: 'sq', fmt: v => (v < 0.001 ? 'Off' : sec(v)) },
  vMode:   { name: 'Mode',       opts: ['Poly', 'Mono', 'Legato'], def: 0 },
  bendRange:{ name: 'Bend',      min: 0, max: 24, step: 1, def: 2, fmt: v => `±${v} st` },
  velAmp:  { name: 'Vélo→Vol',   min: 0, max: 1, def: 0.5, fmt: pct },
  mwVib:   { name: 'Mod→Vibrato',min: 0, max: 2, def: 0.4, curve: 'sq', fmt: v => `${v.toFixed(2)} st` },
  master:  { name: 'Volume',     min: 0, max: 1, def: 0.7, fmt: pct },
  // ── FILTRE
  fType:   { name: 'Type',       opts: ['LP 24', 'LP 12', 'BP', 'HP'], def: 0 },
  cutoff:  { name: 'Cutoff',     min: 20, max: 20000, def: 2000, curve: 'exp', fmt: hz },
  reso:    { name: 'Résonance',  min: 0, max: 1, def: 0.2, fmt: pct },
  fDrive:  { name: 'Drive',      min: 0, max: 1, def: 0.1, fmt: pct },
  fEnv:    { name: 'Env→Cutoff', min: -1, max: 1, def: 0.4, fmt: v => signed(Math.round(v * 100), ' %'), bipolar: true },
  fKey:    { name: 'Suivi clav.',min: 0, max: 1, def: 0.5, fmt: pct },
  fVel:    { name: 'Vélo→Cutoff',min: 0, max: 1, def: 0.3, fmt: pct },
  mwCut:   { name: 'Mod→Cutoff', min: 0, max: 1, def: 0, fmt: pct },
  // ── ENVELOPPES
  fA: { name: 'F. Attaque', min: 0.001, max: 10, def: 0.005, curve: 'exp', fmt: sec },
  fD: { name: 'F. Decay',   min: 0.001, max: 10, def: 0.4,   curve: 'exp', fmt: sec },
  fS: { name: 'F. Sustain', min: 0, max: 1, def: 0.3, fmt: pct },
  fR: { name: 'F. Release', min: 0.001, max: 10, def: 0.4,   curve: 'exp', fmt: sec },
  aA: { name: 'A. Attaque', min: 0.001, max: 10, def: 0.003, curve: 'exp', fmt: sec },
  aD: { name: 'A. Decay',   min: 0.001, max: 10, def: 0.5,   curve: 'exp', fmt: sec },
  aS: { name: 'A. Sustain', min: 0, max: 1, def: 0.8, fmt: pct },
  aR: { name: 'A. Release', min: 0.001, max: 10, def: 0.3,   curve: 'exp', fmt: sec },
  // ── LFO
  l1Shape: { name: 'LFO1 forme', opts: ['Sinus', 'Triangle', 'Rampe', 'Carré', 'Aléa'], def: 0 },
  l1Rate:  { name: 'LFO1 vit.',  min: 0.05, max: 30, def: 5, curve: 'exp', fmt: v => `${v.toFixed(v < 1 ? 2 : 1)} Hz` },
  l1Pitch: { name: 'LFO1→Pitch', min: 0, max: 12, def: 0, curve: 'sq', fmt: v => `${v.toFixed(2)} st` },
  l1Cut:   { name: 'LFO1→Cutoff',min: 0, max: 1, def: 0, fmt: pct },
  l2Shape: { name: 'LFO2 forme', opts: ['Sinus', 'Triangle', 'Rampe', 'Carré', 'Aléa'], def: 1 },
  l2Rate:  { name: 'LFO2 vit.',  min: 0.05, max: 30, def: 0.5, curve: 'exp', fmt: v => `${v.toFixed(v < 1 ? 2 : 1)} Hz` },
  l2Pw:    { name: 'LFO2→PW',    min: 0, max: 1, def: 0, fmt: pct },
  l2Amp:   { name: 'LFO2→Vol',   min: 0, max: 1, def: 0, fmt: pct },
  // ── EFFETS
  dist:    { name: 'Distorsion', min: 0, max: 1, def: 0, fmt: pct },
  chorus:  { name: 'Chorus',     min: 0, max: 1, def: 0.2, fmt: pct },
  dTime:   { name: 'Delay temps',min: 0.02, max: 1.5, def: 0.35, curve: 'exp', fmt: sec },
  dFb:     { name: 'Delay fb',   min: 0, max: 0.95, def: 0.35, fmt: pct },
  dMix:    { name: 'Delay mix',  min: 0, max: 1, def: 0.1, fmt: pct },
  rSize:   { name: 'Reverb taille', min: 0, max: 1, def: 0.6, fmt: pct },
  rDamp:   { name: 'Reverb amort.', min: 0, max: 1, def: 0.5, fmt: pct },
  rMix:    { name: 'Reverb mix', min: 0, max: 1, def: 0.15, fmt: pct },
  // ── ARPÉGIATEUR
  arpOn:   { name: 'Arpège',     opts: ['Off', 'On'], def: 0 },
  arpMode: { name: 'Sens',       opts: ['Montant', 'Descendant', 'Aller-ret.', 'Aléatoire', 'Joué'], def: 0 },
  arpOct:  { name: 'Octaves',    min: 1, max: 4, step: 1, def: 1, fmt: v => `${v}` },
  arpDiv:  { name: 'Division',   opts: ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'], def: 3 },
  arpGate: { name: 'Gate',       min: 0.05, max: 1, def: 0.5, fmt: pct },
  bpm:     { name: 'Tempo',      min: 40, max: 240, step: 1, def: 120, fmt: v => `${v} BPM` },
  arpSwing:{ name: 'Swing',      min: 0, max: 0.5, def: 0, fmt: pct },
  arpLatch:{ name: 'Hold',       opts: ['Off', 'On'], def: 0 },
};

export const PAGES = [
  { id: 'osc1',   name: 'OSC 1',      color: '#ff8a3d', params: ['o1Wave', 'o1Oct', 'o1Semi', 'o1Fine', 'pw', 'o1Lvl', 'uniN', 'uniDet'] },
  { id: 'osc2',   name: 'OSC 2',      color: '#ffc53d', params: ['o2Wave', 'o2Oct', 'o2Semi', 'o2Fine', 'o2Lvl', 'sync', 'fm', 'o2Env'] },
  { id: 'voice',  name: 'VOIX',       color: '#b4e04a', params: ['subLvl', 'noiseLvl', 'glide', 'vMode', 'bendRange', 'velAmp', 'mwVib', 'master'] },
  { id: 'filter', name: 'FILTRE',     color: '#3ddc97', params: ['fType', 'cutoff', 'reso', 'fDrive', 'fEnv', 'fKey', 'fVel', 'mwCut'] },
  { id: 'env',    name: 'ENVELOPPES', color: '#3dc8ff', params: ['fA', 'fD', 'fS', 'fR', 'aA', 'aD', 'aS', 'aR'] },
  { id: 'lfo',    name: 'LFO',        color: '#7b86ff', params: ['l1Shape', 'l1Rate', 'l1Pitch', 'l1Cut', 'l2Shape', 'l2Rate', 'l2Pw', 'l2Amp'] },
  { id: 'fx',     name: 'EFFETS',     color: '#c56bff', params: ['dist', 'chorus', 'dTime', 'dFb', 'dMix', 'rSize', 'rDamp', 'rMix'] },
  { id: 'arp',    name: 'ARPÈGE',     color: '#ff5fa2', params: ['arpOn', 'arpMode', 'arpOct', 'arpDiv', 'arpGate', 'bpm', 'arpSwing', 'arpLatch'] },
];

// Les 4 faders sont toujours sur l'enveloppe d'amplitude.
export const FADERS = ['aA', 'aD', 'aS', 'aR'];

for (const [id, p] of Object.entries(PARAMS)) {
  p.id = id;
  if (p.opts) { p.min = 0; p.max = p.opts.length - 1; p.step = 1; p.fmt = v => p.opts[v]; }
  if (!p.curve) p.curve = 'lin';
}

export function toReal(p, n) {
  let v;
  if (p.curve === 'exp') v = p.min * Math.pow(p.max / p.min, n);
  else if (p.curve === 'sq') v = p.min + (p.max - p.min) * n * n;
  else v = p.min + (p.max - p.min) * n;
  if (p.step) v = Math.round(v / p.step) * p.step;
  return v;
}

export function toNorm(p, v) {
  v = Math.min(p.max, Math.max(p.min, v));
  if (p.curve === 'exp') return Math.log(v / p.min) / Math.log(p.max / p.min);
  if (p.curve === 'sq') return Math.sqrt((v - p.min) / (p.max - p.min));
  return (v - p.min) / (p.max - p.min);
}

export const fmtValue = (p, n) => p.fmt(toReal(p, n));

// Pas par cran d'encodeur relatif : les paramètres à crans (octave, type…) avancent plus vite.
export function relStep(p) {
  const steps = p.step ? (p.max - p.min) / p.step : 0;
  return steps && steps <= 24 ? 1 / (steps * 3) : 1 / 120;
}
