import { describe, expect, it } from 'vitest';
import { gameRegistry } from '@partyhub/games';
import type { GameModule } from '@partyhub/shared';
import { launchCheck, launchCheckAsync } from '../packages/launch-check.js';

function byId(id: string): GameModule {
  const mod = (gameRegistry as GameModule[]).find((g) => g.manifest.id === id);
  if (!mod) throw new Error(`jeu intégré absent : ${id}`);
  return mod;
}

describe('contrôle de lancement, version asynchrone', () => {
  // Un jeu qui passe (quiz, cartes), et un qui échoue (partie non terminée) : même résultat exact dans les deux versions.
  it.each(['quiz-party', 'president', 'bombes-party'])(
    'donne le même résultat que la version synchrone : %s',
    async (id) => {
      expect(await launchCheckAsync(byId(id))).toEqual(launchCheck(byId(id)));
    },
  );

  it('rend la main à la boucle des événements pendant le contrôle', async () => {
    let ticks = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      ticks++;
      setImmediate(tick);
    };
    setImmediate(tick);
    const result = await launchCheckAsync(byId('president'));
    running = false;
    expect(result.ok).toBe(true);
    expect(ticks).toBeGreaterThan(10);
  });
});
