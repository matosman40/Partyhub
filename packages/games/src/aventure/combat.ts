import { COMBAT_ACTIONS, COMBAT_ACTION_INFO, type CombatActionId } from './schemas.js';
import type { Character, Combat, CombatLine, RoundOutcome, RoundReport } from './types.js';

/**
 * Combat tour par tour. Chaque manche, chaque personnage encore debout fait une action (frapper, feinter,
 * soigner, parlementer) : un d20 plus la stat liée à l'action, contre la défense de l'ennemi. Ensuite, l'ennemi
 * riposte sur un personnage au hasard, sauf si une action l'a dissuadé. Les effets sont fixés ici, jamais par l'IA.
 */

export const DIE_SIDES = 20;
/** Au-delà de cette manche, l'ennemi s'enfuit : un combat ne dure jamais indéfiniment. */
export const MAX_ROUNDS = 6;
export const XP_PER_SUCCESS = 3;

const FAIL_TEXT: Record<CombatActionId, string> = {
  frapper: 'Le coup manque.',
  feinter: 'La feinte est repérée.',
  soigner: 'Ses soins n’y font rien.',
  parlementer: 'Personne ne l’écoute.',
};

export function pickAction(random: () => number): CombatActionId {
  return COMBAT_ACTIONS[Math.floor(random() * COMBAT_ACTIONS.length)] ?? 'frapper';
}

interface RoundInput {
  characters: Character[];
  /** Ordre d'arrivée des joueurs : c'est l'ordre dans lequel les actions se règlent. */
  order: string[];
  combat: Combat;
  random: () => number;
  ownerName: (playerId: string) => string | null;
}

export interface RoundResult {
  characters: Character[];
  foeHp: number;
  report: RoundReport;
  outcome: RoundOutcome;
}

/** Règle une manche complète. Les joueurs qui n'ont pas choisi tirent une action au hasard. */
export function resolveRound(input: RoundInput): RoundResult {
  const { combat, random } = input;
  const foe = combat.foe;
  const characters = input.characters.map((c) => ({ ...c }));
  let foeHp = foe.hp;
  let blocked = false;
  const lines: CombatLine[] = [];

  const actors = input.order
    .map((playerId) => characters.find((c) => c.ownerId === playerId && c.pv > 0))
    .filter((c): c is Character => c !== undefined);

  for (const actor of actors) {
    if (foeHp === 0) break;
    const action = combat.actions[actor.ownerId ?? ''] ?? pickAction(random);
    const info = COMBAT_ACTION_INFO[action];
    const bonus = actor.stats[info.stat];
    const roll = Math.floor(random() * DIE_SIDES) + 1;
    const total = roll + bonus;
    const success = roll === DIE_SIDES || (roll !== 1 && total >= foe.defense);

    let text: string;
    if (!success) {
      text = FAIL_TEXT[action];
      if (roll === 1) {
        actor.pv = Math.max(0, actor.pv - 1);
        text += ` ${actor.name} trébuche et se blesse (-1 PV).`;
      }
    } else {
      actor.xp += XP_PER_SUCCESS;
      const critical = roll === DIE_SIDES;
      if (action === 'frapper') {
        const damage = Math.min(foeHp, critical ? 4 : 2);
        foeHp -= damage;
        text = `Le coup porte : ${damage} dégâts.`;
      } else if (action === 'feinter') {
        const damage = Math.min(foeHp, critical ? 2 : 1);
        foeHp -= damage;
        blocked = true;
        text = `La feinte touche : ${damage} dégât${damage > 1 ? 's' : ''}, et l’ennemi ne riposte pas.`;
      } else if (action === 'soigner') {
        const target = lowestWounded(characters);
        if (!target) {
          text = 'Personne n’a besoin de soins.';
        } else {
          const heal = Math.min(target.pvMax - target.pv, critical ? 3 : 2);
          target.pv += heal;
          text = `Il soigne ${target.name} (+${heal} PV).`;
        }
      } else {
        blocked = true;
        text = 'L’ennemi se laisse convaincre : pas de riposte.';
      }
    }

    lines.push({
      characterId: actor.id,
      characterName: actor.name,
      ownerName: input.ownerName(actor.ownerId ?? ''),
      action,
      label: info.label,
      roll,
      bonus,
      total,
      defense: foe.defense,
      success,
      text,
    });
  }

  let riposte: string | null = null;
  let outcome: RoundOutcome = 'ongoing';
  let consequence: string | null = null;

  if (foeHp === 0) {
    outcome = 'victory';
    consequence = foe.onVictory;
  } else {
    const alive = characters.filter((c) => c.ownerId !== null && c.pv > 0);
    if (blocked) {
      riposte = `${foe.name} recule : pas de riposte.`;
    } else if (alive.length > 0) {
      const target = alive[Math.floor(random() * alive.length)] ?? alive[0]!;
      target.pv = Math.max(0, target.pv - foe.damage);
      riposte = `${foe.name} frappe ${target.name} (-${foe.damage} PV).`;
      if (target.pv === 0) riposte += ` ${target.name} est à terre.`;
    }
    if (!characters.some((c) => c.ownerId !== null && c.pv > 0)) {
      outcome = 'defeat';
    } else if (combat.round >= MAX_ROUNDS) {
      outcome = 'flight';
      consequence = `${foe.name} s’enfuit, à bout de souffle.`;
    }
  }

  return {
    characters,
    foeHp,
    outcome,
    report: {
      round: combat.round,
      lines,
      riposte,
      foeHp,
      foeHpMax: foe.hpMax,
      outcome,
      consequence,
    },
  };
}

/** Le personnage le plus blessé encore debout, à soigner. Null si toute l'équipe est en forme. */
function lowestWounded(characters: Character[]): Character | null {
  const wounded = characters.filter((c) => c.ownerId !== null && c.pv > 0 && c.pv < c.pvMax);
  return wounded.reduce<Character | null>((best, c) => (best === null || c.pv < best.pv ? c : best), null);
}
