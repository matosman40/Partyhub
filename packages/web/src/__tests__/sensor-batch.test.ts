import { describe, expect, it } from 'vitest';
import { createSampleBatcher, type SampleBatcher } from '../components/sensorBatch.js';

/** Regroupement des capteurs sur l'écran principal : un lot par image, le dernier échantillon de chaque joueur. */

/** Une planification à la main : rien ne part tant que le test ne passe pas à l'image suivante. */
function manualFrames() {
  let queued: (() => void) | null = null;
  let scheduled = 0;
  return {
    schedule(run: () => void) {
      scheduled++;
      queued = run;
      return () => {
        if (queued === run) queued = null;
      };
    },
    /** Passe à l'image suivante : le lot en attente part, s'il y en a un. */
    nextFrame() {
      const run = queued;
      queued = null;
      run?.();
    },
    get pending() {
      return queued !== null;
    },
    get scheduled() {
      return scheduled;
    },
  };
}

function batcherWith(batches: unknown[]) {
  const frames = manualFrames();
  const batcher: SampleBatcher = createSampleBatcher({
    onFlush: (batch) => void batches.push(batch),
    schedule: frames.schedule,
  });
  return { batcher, frames };
}

describe('Regroupement des capteurs', () => {
  it('envoie un seul lot par image, avec le dernier échantillon de chaque joueur', () => {
    const batches: unknown[] = [];
    const { batcher, frames } = batcherWith(batches);
    for (let i = 0; i < 30; i++) {
      batcher.push({ playerId: 'ana', x: i / 100, y: 0, energy: 0 }, 1000 + i);
      batcher.push({ playerId: 'leo', x: 0, y: -i / 100, energy: 0.5 }, 1000 + i);
    }
    expect(batches).toHaveLength(0);
    frames.nextFrame();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual({
      ana: { x: 0.29, y: 0, energy: 0, at: 1029 },
      leo: { x: 0, y: -0.29, energy: 0.5, at: 1029 },
    });
  });

  it('ne planifie qu’une image pour toute une rafale', () => {
    const batches: unknown[] = [];
    const { batcher, frames } = batcherWith(batches);
    for (let i = 0; i < 10; i++) batcher.push({ playerId: 'ana', x: 0, y: 0, energy: 0 }, i);
    expect(frames.scheduled).toBe(1);
  });

  it('ne envoie rien quand aucun échantillon n’est en attente', () => {
    const batches: unknown[] = [];
    const { frames } = batcherWith(batches);
    expect(frames.pending).toBe(false);
    frames.nextFrame();
    expect(batches).toHaveLength(0);
  });

  it('garde l’heure de réception, même si le lot part plus tard', () => {
    const batches: unknown[] = [];
    const { batcher, frames } = batcherWith(batches);
    batcher.push({ playerId: 'ana', x: 0.5, y: 0, energy: 0.2 }, 42);
    frames.nextFrame();
    expect(batches[0]).toMatchObject({ ana: { at: 42 } });
  });

  it('abandonne le lot en attente quand on arrête', () => {
    const batches: unknown[] = [];
    const { batcher, frames } = batcherWith(batches);
    batcher.push({ playerId: 'ana', x: 0.5, y: 0, energy: 0.2 }, 1);
    batcher.dispose();
    expect(frames.pending).toBe(false);
    frames.nextFrame();
    expect(batches).toHaveLength(0);
  });

  it('reprend après un lot, pour le suivant', () => {
    const batches: unknown[] = [];
    const { batcher, frames } = batcherWith(batches);
    batcher.push({ playerId: 'ana', x: 0.1, y: 0, energy: 0 }, 1);
    frames.nextFrame();
    batcher.push({ playerId: 'ana', x: 0.2, y: 0, energy: 0 }, 60);
    frames.nextFrame();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toMatchObject({ ana: { x: 0.2, at: 60 } });
  });
});
