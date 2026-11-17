// Presets d'usine — seules les valeurs différentes des défauts sont listées (valeurs réelles).
export const FACTORY = [
  { name: 'Init', params: {} },
  {
    name: 'Basse Moog',
    params: { master: 0.85, vMode: 1, o2Wave: 3, o2Oct: -1, o2Fine: 4, o2Lvl: 0.5, subLvl: 0.6, cutoff: 220, reso: 0.35, fDrive: 0.35,
      fEnv: 0.55, fKey: 0.3, fD: 0.25, fS: 0.15, fR: 0.15, aA: 0.002, aD: 0.4, aS: 0.9, aR: 0.08, glide: 0.03,
      chorus: 0, dMix: 0, rMix: 0.05 },
  },
  {
    name: 'Acid 303',
    params: { master: 0.85, vMode: 2, o2Lvl: 0, cutoff: 300, reso: 0.82, fEnv: 0.6, fD: 0.18, fS: 0, fR: 0.1, aA: 0.002, aD: 0.3,
      aS: 0.7, aR: 0.05, glide: 0.06, fDrive: 0.5, dist: 0.25, dTime: 0.375, dFb: 0.4, dMix: 0.18, rMix: 0.05, chorus: 0 },
  },
  {
    name: 'Lead Supersaw',
    params: { master: 0.9, vMode: 2, uniN: 4, uniDet: 22, o2Fine: -8, cutoff: 5000, reso: 0.15, fEnv: 0.2, glide: 0.08,
      l1Pitch: 0.12, l1Rate: 5.5, mwVib: 0.6, chorus: 0.3, dTime: 0.33, dFb: 0.35, dMix: 0.22, rMix: 0.2 },
  },
  {
    name: 'Pad Chaud',
    params: { o2Fine: 9, uniN: 2, uniDet: 15, cutoff: 900, reso: 0.15, fEnv: 0.25, fA: 1.2, fD: 2, fS: 0.5, fR: 2,
      aA: 0.9, aD: 1.5, aS: 0.85, aR: 2.2, l1Cut: 0.08, l1Rate: 0.3, chorus: 0.6, rSize: 0.85, rMix: 0.45, dMix: 0.1 },
  },
  {
    name: 'Cordes PWM',
    params: { master: 0.5, o1Wave: 3, o2Wave: 3, pw: 0.45, o2Fine: 6, l2Pw: 0.6, l2Rate: 0.7, cutoff: 3000, reso: 0.1, fEnv: 0.1,
      aA: 0.4, aD: 1, aS: 0.9, aR: 1.2, chorus: 0.55, rMix: 0.35, rSize: 0.75 },
  },
  {
    name: 'Cuivres',
    params: { o2Fine: 5, cutoff: 600, reso: 0.2, fEnv: 0.55, fA: 0.08, fD: 0.5, fS: 0.45, fR: 0.3, aA: 0.04, aD: 0.5,
      aS: 0.85, aR: 0.25, l1Pitch: 0.08, mwVib: 0.4, chorus: 0.25, rMix: 0.2 },
  },
  {
    name: 'Pluck Delay',
    params: { o2Wave: 3, o2Oct: 1, o2Lvl: 0.3, cutoff: 400, reso: 0.35, fEnv: 0.65, fD: 0.22, fS: 0, fR: 0.2,
      aA: 0.001, aD: 0.45, aS: 0, aR: 0.35, dTime: 0.28, dFb: 0.45, dMix: 0.3, rMix: 0.25 },
  },
  {
    name: 'Sync Lead',
    params: { master: 0.9, vMode: 1, sync: 1, o1Lvl: 0, o2Lvl: 0.9, o2Fine: 0, o2Env: 24, fA: 0.001, fD: 0.6, fS: 0.2, cutoff: 6000,
      reso: 0.1, fEnv: 0.1, glide: 0.04, l1Pitch: 0.1, mwVib: 0.5, dMix: 0.2, rMix: 0.15 },
  },
  {
    name: 'Cloche FM',
    params: { o1Wave: 0, o2Wave: 0, o2Oct: 1, o2Semi: 7, o2Fine: 0, o2Lvl: 0, fm: 0.45, cutoff: 12000, reso: 0, fEnv: 0,
      aA: 0.001, aD: 2.5, aS: 0, aR: 2, rMix: 0.35, dMix: 0.15, chorus: 0.2 },
  },
  {
    name: 'Wobble',
    params: { master: 0.8, vMode: 1, o2Wave: 3, o2Oct: -1, subLvl: 0.5, cutoff: 150, reso: 0.5, l1Cut: 0.9, l1Rate: 3, fEnv: 0,
      fDrive: 0.5, dist: 0.3, aS: 1, aR: 0.1, rMix: 0.05, chorus: 0 },
  },
  {
    name: 'Arpège Électro',
    params: { master: 0.95, arpOn: 1, arpOct: 2, arpDiv: 3, arpGate: 0.45, bpm: 124, arpLatch: 1, o1Wave: 3, pw: 0.3, o2Oct: 1,
      o2Lvl: 0.3, cutoff: 900, reso: 0.45, fEnv: 0.5, fD: 0.15, fS: 0.1, aA: 0.001, aD: 0.25, aS: 0.2, aR: 0.15,
      dTime: 0.363, dFb: 0.4, dMix: 0.25, rMix: 0.2 },
  },
  // ── Sélection premium
  {
    name: '★ Nappe Cinéma',
    params: { master: 0.5, o2Wave: 2.5, o2Fine: -10, o2Lvl: 0.55, uniN: 3, uniDet: 18, noiseLvl: 0.05, velAmp: 0.2,
      cutoff: 1400, reso: 0.18, fEnv: 0.2, fKey: 0.4, fA: 2.5, fD: 3, fS: 0.6, fR: 3, aA: 1.6, aD: 2, aS: 0.9, aR: 3.5,
      l1Shape: 1, l1Rate: 0.18, l1Cut: 0.12, l2Rate: 0.3, l2Pw: 0.3, chorus: 0.7, dTime: 0.48, dFb: 0.45, dMix: 0.18,
      rSize: 0.92, rDamp: 0.35, rMix: 0.5 },
  },
  {
    name: '★ Reese DnB',
    params: { master: 0.85, vMode: 2, glide: 0.05, o2Fine: -15, uniN: 2, uniDet: 10, subLvl: 0.55, cutoff: 420,
      reso: 0.22, fDrive: 0.55, fEnv: 0.15, fA: 0.001, fD: 0.6, fS: 0.7, aA: 0.003, aD: 1, aS: 1, aR: 0.15,
      l1Rate: 0.25, l1Cut: 0.25, dist: 0.3, chorus: 0.15, dMix: 0, rMix: 0.08 },
  },
  {
    name: '★ Hoover Rave',
    params: { master: 0.78, vMode: 2, glide: 0.14, uniN: 4, uniDet: 45, o1Wave: 2.6, pw: 0.35, o2Oct: -1, o2Fine: 0,
      o2Lvl: 0.7, cutoff: 4200, reso: 0.1, fEnv: 0.1, l1Rate: 5, l1Pitch: 0.12, l2Rate: 3, l2Pw: 0.5, mwVib: 0.8,
      dist: 0.15, chorus: 0.8, dMix: 0.12, rMix: 0.25, aR: 0.4 },
  },
  {
    name: '★ Lead Vintage',
    params: { master: 0.85, vMode: 2, glide: 0.07, o1Wave: 3, pw: 0.42, o2Fine: 6, o2Lvl: 0.7, cutoff: 1600, reso: 0.38,
      fEnv: 0.4, fA: 0.02, fD: 0.7, fS: 0.45, fR: 0.3, fVel: 0.5, aA: 0.005, aD: 1, aS: 0.9, aR: 0.25, fDrive: 0.4,
      l1Rate: 5.2, l1Pitch: 0.06, mwVib: 0.5, dTime: 0.375, dFb: 0.38, dMix: 0.25, rMix: 0.22, chorus: 0.15 },
  },
  {
    name: '★ Cristal FM',
    params: { master: 0.6, o1Wave: 0, o2Wave: 0, o2Oct: 2, o2Fine: 3, o2Lvl: 0.12, fm: 0.35, uniN: 2, uniDet: 6,
      cutoff: 9000, reso: 0.05, fEnv: 0, fKey: 0, aA: 0.25, aD: 4, aS: 0.55, aR: 3.5, l1Rate: 0.3, l1Pitch: 0.03,
      l2Rate: 4.5, l2Amp: 0.12, chorus: 0.55, dTime: 0.42, dFb: 0.5, dMix: 0.25, rSize: 0.9, rMix: 0.55 },
  },
  {
    name: '★ Trance Arp',
    params: { master: 1, arpOn: 1, arpLatch: 1, arpMode: 2, arpOct: 3, arpDiv: 3, arpGate: 0.35, uniN: 3, uniDet: 25,
      o2Oct: 1, o2Lvl: 0.35, cutoff: 1100, reso: 0.35, fEnv: 0.45, fD: 0.16, fS: 0.08, fR: 0.15, fVel: 0.3,
      aA: 0.001, aD: 0.3, aS: 0.15, aR: 0.25, dTime: 0.326, dFb: 0.45, dMix: 0.3, rSize: 0.8, rMix: 0.3, chorus: 0.3 },
  },
  {
    name: 'Vent',
    params: { master: 0.55, o1Lvl: 0, o2Lvl: 0, noiseLvl: 0.8, fType: 2, cutoff: 800, reso: 0.7, l1Cut: 0.5, l1Rate: 0.15, l1Shape: 1,
      fEnv: 0, aA: 1.5, aR: 3, rMix: 0.6, rSize: 0.9 },
  },
];
