import { z } from 'zod';
import { CARD_THEMES, cardNoticeSchema } from './card-games.js';

/**
 * Jeu de plateau de parcours : une piste de cases parcourue par des pions au dé.
 * Les jeux de plateau sont des données, comme les jeux de cartes : même format pour
 * les jeux intégrés et ceux créés dans l’administration.
 */

/**
 * Effet d’une case en fin de déplacement :
 * - normal : aucun effet ;
 * - avance : avance de `value` cases de plus ;
 * - recule : recule de `value` cases ;
 * - gain / perte : gagne ou perd `value` points ;
 * - passe : le joueur passe son prochain tour ;
 * - arrivee : fin de la partie, premier arrivé gagnant (toujours la dernière case).
 */
export const BOARD_CELL_KINDS = ['normal', 'avance', 'recule', 'gain', 'perte', 'passe', 'arrivee'] as const;
export type BoardCellKind = (typeof BOARD_CELL_KINDS)[number];

export const BOARD_CELL_LABELS: Record<BoardCellKind, string> = {
  normal: 'Case normale',
  avance: 'Avance de n cases',
  recule: 'Recule de n cases',
  gain: 'Gagne n points',
  perte: 'Perd n points',
  passe: 'Passe le prochain tour',
  arrivee: 'Arrivée (fin de partie)',
};

/** Types dont la valeur numérique a un effet. */
export const BOARD_VALUED_KINDS: readonly BoardCellKind[] = ['avance', 'recule', 'gain', 'perte'];

export const boardCellSchema = z.object({
  label: z.string().trim().max(24),
  kind: z.enum(BOARD_CELL_KINDS),
  /** Cases ou points selon le type. Sans effet pour normal, passe et arrivee. */
  value: z.number().int().min(0).max(12),
});

export const boardRulesSchema = z.object({
  minPlayers: z.number().int().min(2).max(8),
  maxPlayers: z.number().int().min(2).max(8),
  /** Nombre de dés lancés à chaque tour : le total fait avancer le pion. */
  dice: z.number().int().min(1).max(2),
  /** Durée d’un tour avant lancer automatique. 0 = sans limite. */
  turnSeconds: z.number().int().min(0).max(60),
});

export const boardGameBaseSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court.').max(40),
  description: z.string().trim().min(1).max(160),
  icon: z.string().trim().min(1).max(8),
  theme: z.enum(CARD_THEMES),
  cells: z.array(boardCellSchema).min(8, 'Il faut au moins 8 cases.').max(60),
  rules: boardRulesSchema,
  notice: cardNoticeSchema,
});

export const boardGameDefinitionSchema = boardGameBaseSchema.superRefine((def, ctx) => {
  const { minPlayers, maxPlayers } = def.rules;
  if (minPlayers > maxPlayers) {
    ctx.addIssue({ code: 'custom', path: ['rules', 'minPlayers'], message: 'Le minimum dépasse le maximum.' });
  }
  const last = def.cells.length - 1;
  if (def.cells[0]?.kind !== 'normal') {
    ctx.addIssue({
      code: 'custom',
      path: ['cells', 0, 'kind'],
      message: 'La première case (départ) doit être une case normale.',
    });
  }
  if (def.cells[last]?.kind !== 'arrivee') {
    ctx.addIssue({ code: 'custom', path: ['cells', last], message: 'La dernière case doit être la case d’arrivée.' });
  }
  def.cells.forEach((cell, i) => {
    if (cell.kind === 'arrivee' && i !== last) {
      ctx.addIssue({ code: 'custom', path: ['cells', i, 'kind'], message: 'La case d’arrivée doit être la dernière.' });
    }
    if (BOARD_VALUED_KINDS.includes(cell.kind) && cell.value < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['cells', i, 'value'],
        message: `Valeur requise pour « ${BOARD_CELL_LABELS[cell.kind]} ».`,
      });
    }
  });
});

export type BoardCell = z.infer<typeof boardCellSchema>;
export type BoardRules = z.infer<typeof boardRulesSchema>;
export type BoardGameDefinition = z.infer<typeof boardGameDefinitionSchema>;
