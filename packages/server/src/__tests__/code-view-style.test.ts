import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appStylesheet } from '../code-games/build.js';
import { viewEntrySource } from '../code-games/view-entry.js';

describe('feuille de style des vues de jeu de code', () => {
  it('l’amorce des vues embarque la feuille fournie, sans règle de police', () => {
    const source = viewEntrySource('.carte{color:red}');
    expect(source).toContain('.carte{color:red}');
    expect(source).toContain("createElement('style')");
  });

  const web = fileURLToPath(new URL('../../../web/dist/assets', import.meta.url));
  it.skipIf(!existsSync(web))('la feuille de l’application ne garde aucune règle @font-face', () => {
    const css = appStylesheet();
    expect(css.length).toBeGreaterThan(10_000);
    expect(css).not.toMatch(/@font-face/);
  });
});
