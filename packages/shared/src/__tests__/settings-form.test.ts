import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { settingsBounds, settingsIssueMessage } from '../settings-form.js';

describe('bornes des réglages', () => {
  it('lit les bornes des nombres, y compris sous valeur par défaut, et ignore le reste', () => {
    const schema = z.object({
      rounds: z.number().int().min(1).max(15).default(5),
      answerSeconds: z.number().int().min(15).max(120).default(45),
      speedBonus: z.boolean().default(true),
      open: z.number().min(0),
    });
    expect(settingsBounds(schema)).toEqual({
      rounds: { min: 1, max: 15 },
      answerSeconds: { min: 15, max: 120 },
    });
  });

  it('renvoie un objet vide pour un schéma qui n’est pas un objet', () => {
    expect(settingsBounds(z.string())).toEqual({});
  });
});

describe('messages des réglages refusés', () => {
  it('nomme le réglage et donne la limite violée, en français', () => {
    const schema = z.object({ rounds: z.number().int().min(1).max(15) });
    const result = schema.safeParse({ rounds: 99 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(settingsIssueMessage(result.error)).toBe('Réglage « rounds » : au plus 15 attendu.');
    }
  });

  it('signale un type incorrect et un choix non reconnu', () => {
    const schema = z.object({ size: z.union([z.literal(3), z.literal(4)]), count: z.number() });
    const wrongChoice = schema.safeParse({ size: 9, count: 1 });
    const wrongType = schema.safeParse({ size: 3, count: 'deux' });
    if (!wrongChoice.success) expect(settingsIssueMessage(wrongChoice.error)).toBe('Réglage « size » : choix non reconnu.');
    if (!wrongType.success) expect(settingsIssueMessage(wrongType.error)).toBe('Réglage « count » : valeur de type incorrect.');
  });
});
