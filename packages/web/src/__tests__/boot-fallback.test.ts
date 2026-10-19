import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Démarrage de la page : si l’application ne monte pas (script bloqué, réseau coupé), un message et un lien
 * « Recharger » apparaissent au lieu d’un écran sombre et muet. La politique de sécurité (CSP) interdit les
 * scripts en ligne : le secours doit donc rester en HTML et en CSS.
 */
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('Secours au démarrage de la page', () => {
  it('affiche le message de secours après 12 secondes, sans script', () => {
    expect(html).toContain('class="boot-late"');
    expect(html).toContain('ne s’est pas chargé');
    expect(html).toMatch(/animation: boot-late 0\.4s 12s forwards/);
  });

  it('propose un lien pour recharger la page', () => {
    expect(html).toMatch(/<a href="\/">Recharger la page<\/a>/);
  });

  it('ne contient aucun script en ligne, seulement le module de l’application', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toMatch(/\ssrc="/);
    }
  });
});
