import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_CATEGORIES, ADMIN_SUBSECTIONS, isAdminCategory } from '../pages/admin-menu.js';

const adminPageSource = readFileSync(new URL('../pages/AdminPage.tsx', import.meta.url), 'utf8');

describe('menu de l’administration', () => {
  it('chaque rubrique a au moins un sous-menu, sans identifiant en double', () => {
    for (const category of ADMIN_CATEGORIES) {
      const subs = ADMIN_SUBSECTIONS[category.id];
      expect(subs.length, category.id).toBeGreaterThan(0);
      const ids = subs.map((s) => s.id);
      expect(new Set(ids).size, category.id).toBe(ids.length);
    }
  });

  it('les identifiants de sous-menu sont en minuscules avec tirets', () => {
    for (const subs of Object.values(ADMIN_SUBSECTIONS)) {
      for (const sub of subs) expect(sub.id).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('chaque section de la page référence un sous-menu défini', () => {
    const defined = new Set(
      Object.values(ADMIN_SUBSECTIONS)
        .flat()
        .map((s) => s.id),
    );
    const used = [...adminPageSource.matchAll(/hidden=\{activeSub !== '([a-z-]+)'\}/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(defined.has(id), id).toBe(true);
  });

  it('chaque sous-menu défini correspond à au moins une section de la page', () => {
    const used = new Set([...adminPageSource.matchAll(/hidden=\{activeSub !== '([a-z-]+)'\}/g)].map((m) => m[1]));
    for (const sub of Object.values(ADMIN_SUBSECTIONS).flat()) {
      expect(used.has(sub.id), sub.id).toBe(true);
    }
  });

  it('le magasin de jeux est une page publique, hors de l’administration', () => {
    expect(ADMIN_SUBSECTIONS.jeux.map((s) => s.id)).not.toContain('magasin');
    expect(adminPageSource).not.toContain('StoreAdmin');
  });

  it('reconnaît uniquement les rubriques existantes', () => {
    expect(isAdminCategory('jeux')).toBe(true);
    expect(isAdminCategory('inconnue')).toBe(false);
    expect(isAdminCategory(null)).toBe(false);
  });
});
