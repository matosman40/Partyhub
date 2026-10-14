/**
 * Son sans fichier : effets et musique synthétisés avec la Web Audio API.
 * Rien n'est téléchargé. Le contexte audio ne démarre qu'après un geste de
 * l'utilisateur (règle des navigateurs) : tant qu'il n'est pas débloqué, les
 * appels sont simplement ignorés. Le choix muet/son est gardé sur l'appareil.
 */

export type Sfx =
  | 'place'
  | 'explode'
  | 'crate'
  | 'pickup'
  | 'die'
  | 'hit'
  | 'start'
  | 'win'
  | 'final'
  | 'click'
  | 'card'
  | 'draw'
  | 'turn'
  | 'chip';

const MUTE_KEY = 'ph:muted';
const BPM = 128;
const STEP = 60 / BPM / 2; // croches

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noise: AudioBuffer | null = null;
let unlocked = false;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(value: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* sans effet */
  }
}

function context(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.7;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.2;
      musicBus.connect(master);
      noise = makeNoise(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function makeNoise(c: AudioContext): AudioBuffer {
  const buffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Débloque le son. À appeler depuis un clic ou un toucher. */
export function unlockAudio(): void {
  unlocked = true;
  context();
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  saveMuted(value);
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.85, ctx.currentTime, 0.03);
}

function tone(
  c: AudioContext,
  bus: GainNode,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  endFreq?: number,
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(bus);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function burst(
  c: AudioContext,
  bus: GainNode,
  start: number,
  dur: number,
  gain: number,
  filterType: BiquadFilterType,
  fromHz: number,
  toHz: number,
): void {
  if (!noise) return;
  const src = c.createBufferSource();
  src.buffer = noise;
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(fromHz, start);
  filter.frequency.exponentialRampToValueAtTime(toHz, start + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(bus);
  src.start(start, Math.random() * 0.5, dur + 0.05);
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Dédoublonnage : le téléviseur et son siège, sur le même appareil, reçoivent le même événement.
const lastPlayed = new Map<Sfx, number>();

/** Joue un effet sonore. Ignoré si le son est coupé ou pas encore débloqué. */
export function play(name: Sfx): void {
  if (muted || !unlocked) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < 60) return;
  lastPlayed.set(name, now);
  const c = context();
  if (!c || !sfxBus) return;
  const t = c.currentTime + 0.005;
  const bus = sfxBus;
  switch (name) {
    case 'place':
      tone(c, bus, 'sine', 620, t, 0.14, 0.35, 300);
      break;
    case 'explode':
      burst(c, bus, t, 0.55, 0.9, 'lowpass', 1400, 120);
      tone(c, bus, 'sine', 110, t, 0.45, 0.8, 38);
      break;
    case 'crate':
      burst(c, bus, t, 0.14, 0.5, 'highpass', 2400, 600);
      break;
    case 'pickup':
      [660, 880, 1320].forEach((f, i) => tone(c, bus, 'square', f, t + i * 0.055, 0.09, 0.18));
      break;
    case 'die':
      tone(c, bus, 'sawtooth', 420, t, 0.7, 0.35, 70);
      break;
    case 'hit':
      tone(c, bus, 'square', 330, t, 0.16, 0.22, 180);
      break;
    case 'start':
      [60, 64, 67, 72].forEach((n, i) => tone(c, bus, 'triangle', midi(n), t + i * 0.1, 0.22, 0.35));
      break;
    case 'win':
      [72, 76, 79, 84, 79, 84].forEach((n, i) => tone(c, bus, 'square', midi(n), t + i * 0.09, 0.2, 0.16));
      break;
    case 'final':
      [60, 67, 72, 76, 79, 84].forEach((n, i) => tone(c, bus, 'triangle', midi(n), t + i * 0.13, 0.5, 0.3));
      break;
    case 'card':
      // Carte posée sur la table : un claquement bref, plus une note grave.
      burst(c, bus, t, 0.08, 0.4, 'highpass', 3000, 1200);
      tone(c, bus, 'triangle', 520, t, 0.06, 0.14, 360);
      break;
    case 'draw':
      // Pioche : un glissement de carte, plus discret.
      burst(c, bus, t, 0.14, 0.28, 'bandpass', 1600, 900);
      break;
    case 'turn':
      // Votre tour : deux notes montantes.
      [76, 83].forEach((n, i) => tone(c, bus, 'triangle', midi(n), t + i * 0.085, 0.2, 0.28));
      break;
    case 'click':
      tone(c, bus, 'square', 880, t, 0.04, 0.12);
      break;
    case 'chip':
      // Jetons poussés sur le tapis : deux cliquetis rapprochés.
      burst(c, bus, t, 0.035, 0.35, 'highpass', 5200, 3800);
      burst(c, bus, t + 0.05, 0.035, 0.28, 'highpass', 4800, 3600);
      tone(c, bus, 'sine', 2400, t, 0.03, 0.06);
      break;
  }
}

// ---------------------------------------------------------------------------
// Musique : boucle chiptune en la mineur, séquencée avec anticipation.
// ---------------------------------------------------------------------------

const BASS = [45, 45, 52, 45, 41, 41, 48, 41, 43, 43, 50, 43, 40, 40, 47, 40];
const LEAD = [69, 72, 76, 72, 67, 71, 74, 71, 65, 69, 72, 69, 64, 68, 71, 68];
let timer: number | null = null;
let nextTime = 0;
let stepIndex = 0;

function scheduleStep(c: AudioContext, at: number, i: number): void {
  if (!musicBus) return;
  const bass = BASS[i % BASS.length] ?? 45;
  const lead = LEAD[i % LEAD.length] ?? 69;
  tone(c, musicBus, 'triangle', midi(bass), at, STEP * 1.7, 0.6);
  if (i % 2 === 0) tone(c, musicBus, 'square', midi(lead), at, STEP * 0.8, 0.12);
  if (i % 4 === 2 && noise) burst(c, musicBus, at, 0.05, 0.25, 'highpass', 6000, 3000);
}

/** Démarre la musique de fond (à l'écran principal). */
export function startMusic(): void {
  if (timer !== null) return;
  const c = context();
  if (!c) return;
  nextTime = c.currentTime + 0.1;
  timer = window.setInterval(() => {
    if (!unlocked) return;
    while (nextTime < c.currentTime + 0.15) {
      scheduleStep(c, nextTime, stepIndex);
      nextTime += STEP;
      stepIndex++;
    }
  }, 40);
}

export function stopMusic(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}
