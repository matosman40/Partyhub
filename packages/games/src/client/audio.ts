/**
 * Son sans fichier par défaut : effets et musique synthétisés avec la Web Audio API. L’administration
 * peut remplacer un bruitage par un fichier de la médiathèque (voir setSfxFiles). Le contexte audio ne
 * démarre qu’après un geste de l’utilisateur (règle des navigateurs) : tant qu’il n’est pas débloqué,
 * les appels sont simplement ignorés. Le choix muet/son est gardé sur l’appareil.
 */

import type { SfxName } from '@partyhub/shared';
import { loadMediaBytes } from './media-relay.js';

export type Sfx = SfxName;

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

/**
 * Débloque le son au premier geste de l’utilisateur, où qu’il soit sur la page : salon, menu, téléphone ou
 * vue de jeu. Sans cela, le départ lancé depuis le salon de l’écran principal reste muet tant que personne
 * n’a touché la vue de jeu.
 */
export function unlockOnFirstGesture(target: Document = document): void {
  if (unlocked) return;
  const events = ['pointerdown', 'keydown'] as const;
  const once = () => {
    unlockAudio();
    for (const type of events) target.removeEventListener(type, once, true);
  };
  for (const type of events) target.addEventListener(type, once, true);
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export function isMuted(): boolean {
  return muted;
}

const muteListeners = new Set<(value: boolean) => void>();

/** Prévient quand le bouton muet change (la musique de menu s’arrête ou reprend avec lui). */
export function onMuteChange(listener: (value: boolean) => void): () => void {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}

export function setMuted(value: boolean): void {
  muted = value;
  saveMuted(value);
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.85, ctx.currentTime, 0.03);
  for (const listener of muteListeners) listener(value);
}

// Bruitages remplacés par un fichier : adresse par effet, et tampon décodé une fois par adresse.
let sfxUrls: Partial<Record<Sfx, string>> = {};
const sfxBuffers = new Map<string, AudioBuffer>();
const sfxPending = new Set<string>();

/**
 * Règle les fichiers de bruitage (adresses publiques, ou null pour le son d’origine). Un fichier
 * encore en chargement laisse jouer le son d’origine, sans bloquer l’effet.
 */
export function setSfxFiles(files: Partial<Record<Sfx, string | null>>): void {
  const next: Partial<Record<Sfx, string>> = {};
  for (const [name, url] of Object.entries(files) as [Sfx, string | null | undefined][]) {
    if (url) next[name] = url;
  }
  sfxUrls = next;
}

// Une vue de jeu de code (iframe) reçoit la table des bruitages de la page : elle la règle ici.
(globalThis as { __partyhubSfxSink?: typeof setSfxFiles }).__partyhubSfxSink = setSfxFiles;

function loadSfxFile(c: AudioContext, url: string): void {
  if (sfxBuffers.has(url) || sfxPending.has(url)) return;
  sfxPending.add(url);
  loadMediaBytes(url)
    .then((bytes) => c.decodeAudioData(bytes))
    .then((buffer) => sfxBuffers.set(url, buffer))
    .catch(() => {
      /* fichier illisible : le son d’origine reste joué */
    })
    .finally(() => sfxPending.delete(url));
}

function playSfxFile(c: AudioContext, bus: GainNode, url: string): boolean {
  const buffer = sfxBuffers.get(url);
  if (!buffer) {
    loadSfxFile(c, url);
    return false;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(bus);
  src.start(c.currentTime + 0.005);
  return true;
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

/** Instant du dernier bruitage joué par un jeu : la couche de l’écran principal s’efface devant lui. */
let gameSoundAt = Number.NEGATIVE_INFINITY;
/** Délai pendant lequel un bruitage de jeu prime sur celui de la couche de l’écran principal. */
const GAME_PRIORITY_MS = 300;

/** Planifie un effet sonore. Vrai quand il sonne, faux quand il est ignoré (coupé, déjà joué, pas débloqué). */
function scheduleSound(name: Sfx): boolean {
  if (muted || !unlocked) return false;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < 60) return false;
  lastPlayed.set(name, now);
  const c = context();
  if (!c || !sfxBus) return false;
  const t = c.currentTime + 0.005;
  const bus = sfxBus;
  const file = sfxUrls[name];
  if (file && playSfxFile(c, bus, file)) return true;
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
  return true;
}

/** Joue un effet sonore d’un jeu. Ignoré si le son est coupé ou pas encore débloqué. */
export function play(name: Sfx): void {
  if (scheduleSound(name)) gameSoundAt = performance.now();
}

/**
 * Vrai quand un bruitage de la couche d’écran cède la place : un bruitage de jeu vient de sonner (il fait
 * déjà le bilan), donc on ne double pas. La fanfare finale sonne toujours. Fonction pure.
 */
export function cueYieldsToGame(name: Sfx, msSinceGameSound: number): boolean {
  return name !== 'final' && msSinceGameSound < GAME_PRIORITY_MS;
}

/** Joue un bruitage de la couche d’écran principal (début, bilan, fin), sauf s’il cède à un jeu. */
export function playCue(name: Sfx): void {
  if (cueYieldsToGame(name, performance.now() - gameSoundAt)) return;
  scheduleSound(name);
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

/** Démarre la musique de fond (à l’écran principal). */
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

// ---------------------------------------------------------------------------
// Musique d’un paquet : un fichier en boucle sur le bus de musique (musique de partie d’un jeu importé).
// ---------------------------------------------------------------------------

let loopSource: AudioBufferSourceNode | null = null;
let loopToken = 0;

/** Joue un fichier audio en boucle, à la place de la boucle précédente. Ignoré si le son n’est pas disponible. */
export function playLoopFile(url: string): void {
  stopLoopFile();
  const token = loopToken;
  const c = context();
  const bus = musicBus;
  if (!c || !bus) return;
  loadMediaBytes(url)
    .then((bytes) => c.decodeAudioData(bytes))
    .then((buffer) => {
      if (token !== loopToken) return; // arrêtée entre-temps
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(bus);
      src.start(c.currentTime + 0.05);
      loopSource = src;
    })
    .catch(() => {
      /* fichier illisible : pas de musique de partie */
    });
}

/** Arrête la boucle de musique d’un paquet, s’il y en a une. */
export function stopLoopFile(): void {
  loopToken++;
  if (loopSource) {
    try {
      loopSource.stop();
    } catch {
      /* déjà arrêtée */
    }
    loopSource.disconnect();
    loopSource = null;
  }
}
