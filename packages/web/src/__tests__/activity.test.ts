import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleTracker, IDLE_MS } from '../pages/tv/useActivity.js';

/** Commandes discrètes : elles s'effacent après 3,5 s sans action, et reviennent à la moindre action. */

describe('Minuterie d’inactivité', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('garde un délai de 3,5 s', () => {
    expect(IDLE_MS).toBe(3500);
  });

  it('n’appelle onIdle qu’après le délai complet sans action', () => {
    const onIdle = vi.fn();
    const idle = createIdleTracker(onIdle);
    idle.wake();
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('repousse le délai à chaque action', () => {
    const onIdle = vi.fn();
    const idle = createIdleTracker(onIdle);
    idle.wake();
    vi.advanceTimersByTime(3000);
    idle.wake();
    vi.advanceTimersByTime(3000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('ne se déclenche plus une fois arrêtée', () => {
    const onIdle = vi.fn();
    const idle = createIdleTracker(onIdle);
    idle.wake();
    idle.stop();
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('accepte un délai et une horloge personnalisés', () => {
    const set = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clear = vi.fn((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    const onIdle = vi.fn();
    const idle = createIdleTracker(onIdle, 1000, { set, clear });
    idle.wake();
    expect(set).toHaveBeenCalledWith(onIdle, 1000);
    idle.wake();
    expect(clear).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
