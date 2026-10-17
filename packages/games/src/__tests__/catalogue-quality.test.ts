import { describe, expect, it } from 'vitest';
import { gameRegistry } from '../index.js';

/**
 * Contrôle qualité du catalogue : chaque jeu listé doit présenter une fiche complète et propre
 * (titre, icône, description, notice). Un nouveau jeu qui ne respecte pas ces règles fait échouer
 * ce test, sans qu'il faille le déclarer nulle part. Les identifiants et réglages sont vérifiés
 * dans registry.test.ts.
 */

const listed = gameRegistry.filter((g) => g.manifest.listed !== false);

/** Limites de présentation : elles correspondent à ce qui tient proprement dans une carte du catalogue. */
const LIMITS = {
  nameMax: 28,
  descriptionMin: 40,
  descriptionMax: 180,
  goalMin: 20,
  stepsMin: 2,
  stepsMax: 12,
  stepMax: 200,
  tipsMax: 6,
  playersMax: 12,
  durationMax: 60,
};

/** Liste des défauts d'une fiche. Vide quand la fiche est propre. */
function problems(game: (typeof gameRegistry)[number]): string[] {
  const m = game.manifest;
  const n = m.notice;
  const out: string[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id)) out.push('identifiant hors minuscules et tirets');
  if (m.name.trim() !== m.name || m.name.length === 0) out.push('nom vide ou espacé');
  if (m.name.length > LIMITS.nameMax) out.push(`nom de plus de ${LIMITS.nameMax} caractères`);
  if (!m.icon || m.icon.trim() !== m.icon) out.push('icône absente ou espacée');
  if (m.description.length < LIMITS.descriptionMin || m.description.length > LIMITS.descriptionMax) {
    out.push(`description hors de ${LIMITS.descriptionMin} à ${LIMITS.descriptionMax} caractères`);
  }
  if (!/[.!?…]$/.test(m.description.trim())) out.push('description sans ponctuation finale');
  if (n.goal.trim().length < LIMITS.goalMin) out.push('but de la notice trop court');
  if (n.steps.length < LIMITS.stepsMin || n.steps.length > LIMITS.stepsMax) {
    out.push(`${n.steps.length} étapes (attendu : ${LIMITS.stepsMin} à ${LIMITS.stepsMax})`);
  }
  if (n.steps.some((s) => s.trim().length === 0 || s.length > LIMITS.stepMax)) out.push('étape vide ou trop longue');
  if (n.tips.length > LIMITS.tipsMax) out.push(`${n.tips.length} conseils (maximum ${LIMITS.tipsMax})`);
  if (n.tips.some((t) => t.trim().length === 0)) out.push('conseil vide');
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) out.push('version qui n’est pas en x.y.z');
  if (m.maxPlayers > LIMITS.playersMax) out.push(`plus de ${LIMITS.playersMax} joueurs`);
  if (m.durationMin > LIMITS.durationMax) out.push(`durée de plus de ${LIMITS.durationMax} minutes`);
  return out;
}

describe('Fiches du catalogue', () => {
  it('ont une fiche complète et propre (titre, description, notice, joueurs)', () => {
    const defects = Object.fromEntries(
      listed.map((g) => [g.manifest.id, problems(g)]).filter(([, p]) => (p as string[]).length > 0),
    );
    expect(defects).toEqual({});
  });

  it('ont chacun une icône propre, pour distinguer les jeux d’un coup d’œil', () => {
    const icons = listed.map((g) => g.manifest.icon);
    const duplicates = icons.filter((icon, i) => icons.indexOf(icon) !== i);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it('ont un nom unique', () => {
    const names = listed.map((g) => g.manifest.name.trim().toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
