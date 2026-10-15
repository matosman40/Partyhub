import { describe, expect, it } from 'vitest';
import { PLATEAU_TEST_ID } from '@partyhub/shared';
import { plateauTest } from '../plateau-test/module.js';
import { findGame } from '../index.js';

describe('Plateau de test (jeu sans partie)', () => {
  it('est enregistré, mais non listé au catalogue', () => {
    expect(findGame(PLATEAU_TEST_ID)).toBe(plateauTest);
    expect(plateauTest.manifest.listed).toBe(false);
  });

  it('refuse le lancement et toute action de jeu', () => {
    const ctx = { now: () => 0, random: () => 0.5, schedule: () => undefined, cancel: () => undefined };
    const state = plateauTest.initialize({}, [], ctx as never);
    expect(plateauTest.start(state, ctx as never).ok).toBe(false);
    expect(plateauTest.handleAction(state, { id: 'a', name: 'A' } as never, 'tap', {}, ctx as never).ok).toBe(false);
    expect(Object.keys(plateauTest.actions)).toHaveLength(0);
  });
});
