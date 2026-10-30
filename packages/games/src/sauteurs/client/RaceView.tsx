import { useContext, useEffect, useRef } from 'react';
import { defaultCharacterFor, type CharacterSpec } from '@partyhub/shared';
import { AvatarsContext } from '../../client/avatar-context.js';
import { play } from '../../client/audio.js';
import { PauseContext } from '../../client/hooks.js';
import { SensorsContext, type SensorReading } from '../../client/sensors.js';
import { createWorld, step, summary, type PlayerInput, type World } from '../engine.js';
import { LEVELS } from '../levels.js';
import { KeyboardState, mergeInputs, sampleToInput } from './input.js';
import { RaceRenderer, type RacerInfo } from './renderer.js';
import { FixedStepper } from './stepper.js';
import type { SauteursHostState, SauteursPub } from './types.js';

/**
 * La course, vue de l'écran principal : un canvas plein écran, une boucle `requestAnimationFrame` à pas fixe de
 * 1/60 s. Aucun état React par image : le monde, la caméra et les commandes vivent dans des références ; seuls
 * quelques attributs `data-*` du conteneur sont mis à jour (pour les tests et le suivi).
 */

export interface RaceViewProps {
  pub: SauteursPub;
  hostState: SauteursHostState | null;
  /** Horloge serveur à la réception de la vue. */
  now: number;
  onAction?: (type: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>;
}

/** Délai entre la fin de la course et l'envoi des résultats : on laisse voir l'arrivée. */
const SEND_DELAY_MS = 1600;
const SEND_RETRY_MS = 1500;
const SEND_TRIES = 5;
/** Les données `data-*` sont rafraîchies une image sur six. */
const DATA_EVERY = 6;

export function specOf(avatars: Record<string, { character?: CharacterSpec | null }>, name: string): CharacterSpec {
  return avatars[name]?.character ?? defaultCharacterFor(name);
}

export function racersFor(
  pub: SauteursPub,
  hostState: SauteursHostState | null,
  avatars: Record<string, { character?: CharacterSpec | null }>,
): RacerInfo[] {
  const byId = new Map(pub.players.map((p) => [p.id, p]));
  const ids = (
    hostState?.expected?.length ? hostState.expected : pub.players.filter((p) => !p.left).map((p) => p.id)
  ).filter((id) => byId.has(id));
  return ids.map((id) => {
    const p = byId.get(id)!;
    const spec = specOf(avatars, p.name);
    return { id, name: p.name, spec, specKey: JSON.stringify(spec), left: p.left };
  });
}

export function RaceView({ pub, hostState, now, onAction }: RaceViewProps) {
  const avatars = useContext(AvatarsContext);
  const paused = useContext(PauseContext);
  const sensors = useContext(SensorsContext);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Tout ce que la boucle lit passe par une référence : elle n'est jamais relancée par un rendu.
  const latest = useRef({ pub, hostState, onAction, paused, avatars });
  const sensorsRef = useRef<Record<string, SensorReading>>(sensors);
  const clock = useRef({ offset: -Infinity });
  useEffect(() => {
    latest.current = { pub, hostState, onAction, paused, avatars };
    sensorsRef.current = sensors;
  });
  useEffect(() => {
    // Décalage entre l'horloge serveur et celle de la page : le meilleur (le plus grand) vaut le trajet le plus court.
    clock.current.offset = Math.max(clock.current.offset, now - performance.now());
  }, [now]);

  const levelIndex = pub.levelIndex ?? 0;

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const level = LEVELS[levelIndex];
    if (!box || !canvas || !level) return;
    const first = latest.current;
    const racers = racersFor(first.pub, first.hostState, first.avatars);
    const world: World = createWorld(
      level,
      racers.map((r) => r.id),
    );
    const reducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new RaceRenderer(canvas, world, racers, { reducedMotion, sfx: play });
    renderer.resize(canvas);
    const stepper = new FixedStepper();
    const keyboard = new KeyboardState();
    const kbInput: PlayerInput = { left: false, right: false, jump: false };
    const phoneInput: PlayerInput = { left: false, right: false, jump: false };
    const inputs: Record<string, PlayerInput> = {};
    for (const r of racers) inputs[r.id] = { left: false, right: false, jump: false };
    const firstId = racers[0]?.id;

    // Repli clavier : le premier joueur se commande aussi au clavier quand l'hôte a une souris (ordinateur).
    const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (keyboard.set(e.code, down)) e.preventDefault();
    };
    const onDown = onKey(true);
    const onUp = onKey(false);
    const onBlur = () => keyboard.reset();
    if (fine) {
      window.addEventListener('keydown', onDown);
      window.addEventListener('keyup', onUp);
      window.addEventListener('blur', onBlur);
    }

    const ro = new ResizeObserver(() => renderer.resize(canvas));
    ro.observe(box);

    let raf = 0;
    let last = performance.now();
    let started = false;
    let overAt = 0;
    let sendState: 'idle' | 'sending' | 'sent' | 'failed' = 'idle';
    let beep = '';
    let frames = 0;
    let fpsFrames = 0;
    let fpsSince = last;
    let fps = 0;
    let workMs = 0;
    let disposed = false;
    let retryTimer = 0;

    const sendResults = (attempt: number) => {
      const cur = latest.current;
      if (!cur.onAction || disposed) {
        sendState = 'sent';
        return;
      }
      sendState = 'sending';
      const results = world.players.map((p) => {
        const s = summary(world, p.id);
        return { playerId: p.id, finishTick: s.finished ? s.finishTick : null, coins: s.coins, deaths: s.deaths };
      });
      void cur
        .onAction('level-result', { levelIndex, results })
        .then((res) => {
          if (disposed) return;
          if (res.ok) {
            sendState = 'sent';
          } else if (attempt + 1 < SEND_TRIES) {
            retryTimer = window.setTimeout(() => sendResults(attempt + 1), SEND_RETRY_MS);
          } else {
            sendState = 'failed';
            box.dataset.sendError = res.error ?? 'refusé';
          }
        })
        .catch(() => {
          if (disposed) return;
          if (attempt + 1 < SEND_TRIES) retryTimer = window.setTimeout(() => sendResults(attempt + 1), SEND_RETRY_MS);
          else sendState = 'failed';
        });
    };

    const publish = () => {
      box.dataset.tick = String(world.tick);
      box.dataset.over = String(world.over);
      box.dataset.scale = String(renderer.cam.scale);
      box.dataset.fps = String(fps);
      box.dataset.workMs = workMs.toFixed(2);
      box.dataset.send = sendState;
      box.dataset.players = JSON.stringify(
        world.players.map((p) => ({
          id: p.id,
          name: racers.find((r) => r.id === p.id)?.name ?? '',
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          anim: p.anim,
          coins: p.coins,
          deaths: p.deaths,
          finished: p.finished,
          rank: p.rank,
        })),
      );
    };

    const frame = (t: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const work0 = performance.now();
      const dt = t - last;
      last = t;
      frames++;
      fpsFrames++;
      if (t - fpsSince >= 1000) {
        fps = Math.round((fpsFrames * 1000) / (t - fpsSince));
        fpsFrames = 0;
        fpsSince = t;
      }
      const cur = latest.current;
      const serverNow = t + clock.current.offset;
      const countdownMs = Number.isFinite(clock.current.offset) ? cur.pub.startedAt - serverNow : 3000;

      // Compte à rebours : un bip par chiffre.
      const label = countdownMs > 2000 ? '3' : countdownMs > 1000 ? '2' : countdownMs > 0 ? '1' : '';
      if (label && label !== beep) {
        beep = label;
        play('click');
      }
      if (!started && countdownMs <= 0 && Number.isFinite(clock.current.offset)) {
        started = true;
        stepper.reset(Math.min(-countdownMs, 200));
        play('start');
      }

      if (started && !cur.paused && !world.over) {
        const n = stepper.push(dt);
        const nowMs = performance.now();
        for (let i = 0; i < n && !world.over; i++) {
          for (const r of racers) {
            const reading = sensorsRef.current[r.id];
            const input = inputs[r.id]!;
            if (r.id === firstId && fine) {
              sampleToInput(reading, nowMs, phoneInput);
              mergeInputs(phoneInput, keyboard.read(kbInput), input);
            } else {
              sampleToInput(reading, nowMs, input);
            }
          }
          renderer.snapshot();
          step(world, inputs);
          renderer.afterStep();
        }
        if (world.over && overAt === 0) overAt = t;
      } else if (!started) {
        // Avant le départ la caméra se pose déjà sur la ligne de départ.
        if (frames % 2 === 0) {
          renderer.snapshot();
          renderer.afterStep();
        }
      }

      if (world.over && sendState === 'idle' && t - overAt >= SEND_DELAY_MS) sendResults(0);

      renderer.draw(started && !world.over ? stepper.alpha : 1, {
        levelName: level.name,
        step: cur.pub.step,
        levelCount: cur.pub.levelCount,
        countdownMs: started ? Math.min(countdownMs, 0) : countdownMs,
        timeLimit: level.timeLimit,
      });
      workMs = workMs * 0.95 + (performance.now() - work0) * 0.05;
      if (frames % DATA_EVERY === 0) publish();
    };
    publish();
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(retryTimer);
      ro.disconnect();
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [levelIndex]);

  const tv = Boolean(onAction);
  return (
    <div
      ref={boxRef}
      className={`sau-race ${tv ? 'is-tv' : 'is-embedded'}`}
      data-phase={pub.phase}
      data-level={levelIndex}
      data-testid="sauteurs-race"
    >
      <canvas
        ref={canvasRef}
        className="sau-canvas"
        role="img"
        aria-label={`Course des sauteurs, niveau ${pub.step} sur ${pub.levelCount} : ${pub.level?.name ?? ''}`}
      />
    </div>
  );
}
