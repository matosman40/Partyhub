import { useState, type ReactNode } from 'react';
import {
  CHARACTER_ACCESSORIES,
  CHARACTER_BODY_COLORS,
  CHARACTER_HAIR_COLORS,
  CHARACTER_HAIR_STYLES,
  CHARACTER_MOODS,
  CHARACTER_SKIN_TONES,
  type CharacterAccessory,
  type CharacterMood,
  type CharacterSpec,
  type HairStyle,
} from '@partyhub/shared';
import { Character, PackFigure, useCharacterPacks } from '@partyhub/games/client';

/** Noms affichés pour chaque choix. Les clés sont les valeurs de la liste partagée. */
const BODY_NAMES: Record<string, string> = {
  '#ff7a8f': 'Rose',
  '#3ff5e0': 'Turquoise',
  '#8b5cff': 'Violet',
  '#ffc83d': 'Jaune',
  '#7ee787': 'Vert',
  '#ff9f43': 'Orange',
  '#2f5dd6': 'Bleu',
  '#f7f4ff': 'Blanc',
};
const SKIN_NAMES: Record<string, string> = {
  '#ffe0bd': 'Clair',
  '#f6c7a1': 'Doré',
  '#e9a77a': 'Mat',
  '#c98b62': 'Caramel',
  '#8d5a3b': 'Foncé',
};
const HAIR_COLOR_NAMES: Record<string, string> = {
  '#1b1040': 'Brun foncé',
  '#7a4a2a': 'Châtain',
  '#ff9f43': 'Orange',
  '#ff5d8f': 'Rose',
  '#5b3cc4': 'Violet',
  '#f1e3c8': 'Blond',
};
const HAIR_NAMES: Record<HairStyle, string> = {
  none: 'Aucun',
  short: 'Court',
  bob: 'Carré',
  spiky: 'Piquant',
  bun: 'Chignon',
  curly: 'Bouclés',
};
const ACCESSORY_NAMES: Record<CharacterAccessory, string> = {
  none: 'Aucun',
  party: 'Fête',
  crown: 'Couronne',
  cap: 'Casquette',
  glasses: 'Lunettes',
  headphones: 'Casque',
  bow: 'Nœud',
  flower: 'Fleur',
};
const MOOD_NAMES: Record<CharacterMood, string> = {
  idle: 'Repos',
  joy: 'Joie',
  sad: 'Triste',
  wave: 'Salut',
  dance: 'Danse',
};

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="chara-group">
      <legend>{label}</legend>
      <div className="chara-choices">{children}</div>
    </fieldset>
  );
}

/**
 * Éditeur du personnage du profil : aperçu animé et choix dans des listes fermées.
 * Chaque choix est enregistré tout de suite, comme les autres réglages du profil.
 */
export function CharacterEditor({
  spec,
  busy,
  onChange,
}: {
  spec: CharacterSpec;
  busy: boolean;
  onChange: (spec: CharacterSpec) => void;
}) {
  const [mood, setMood] = useState<CharacterMood>('idle');
  const packs = useCharacterPacks();
  // Un pack supprimé depuis ne s'affiche plus : le personnage dessiné reprend la main.
  const activePack = !!spec.pack && packs.packs.some((pack) => pack.id === spec.pack);
  const pick = (patch: Partial<CharacterSpec>) => onChange({ ...spec, ...patch });

  return (
    <div className="chara-editor">
      <div className="chara-stage">
        <div className="chara-stage-figure">
          <Character spec={spec} mood={mood} label="Aperçu de votre personnage" />
        </div>
        <div className="chara-moods" role="group" aria-label="Attitude de l’aperçu">
          {CHARACTER_MOODS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={mood === m} onClick={() => setMood(m)}>
              {MOOD_NAMES[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="chara-options">
        <Group label="Personnage">
          <button
            type="button"
            className="chip"
            aria-pressed={!activePack}
            disabled={busy}
            onClick={() => pick({ pack: null })}
          >
            Personnage dessiné
          </button>
          {packs.packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="chip chip-pack"
              aria-pressed={spec.pack === pack.id}
              disabled={busy}
              onClick={() => pick({ pack: pack.id })}
            >
              <span className="chara-pack-thumb">
                <PackFigure pack={pack} framing="bust" />
              </span>
              {pack.name}
            </button>
          ))}
          {packs.status === 'error' && packs.packs.length === 0 && (
            <p className="muted small">Les personnages illustrés ne sont pas disponibles pour le moment.</p>
          )}
        </Group>
        {!activePack && (
          <>
            <Group label="Couleur du corps">
              {CHARACTER_BODY_COLORS.map((color, i) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-pressed={spec.body === i}
                  aria-label={BODY_NAMES[color] ?? color}
                  title={BODY_NAMES[color]}
                  disabled={busy}
                  onClick={() => pick({ body: i })}
                />
              ))}
            </Group>
            <Group label="Teint">
              {CHARACTER_SKIN_TONES.map((color, i) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-pressed={spec.skin === i}
                  aria-label={SKIN_NAMES[color] ?? color}
                  title={SKIN_NAMES[color]}
                  disabled={busy}
                  onClick={() => pick({ skin: i })}
                />
              ))}
            </Group>
            <Group label="Coiffure">
              {CHARACTER_HAIR_STYLES.map((style, i) => (
                <button
                  key={style}
                  type="button"
                  className="chip"
                  aria-pressed={spec.hair === i}
                  disabled={busy}
                  onClick={() => pick({ hair: i })}
                >
                  {HAIR_NAMES[style]}
                </button>
              ))}
            </Group>
            <Group label="Couleur des cheveux">
              {CHARACTER_HAIR_COLORS.map((color, i) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-pressed={spec.hairColor === i}
                  aria-label={HAIR_COLOR_NAMES[color] ?? color}
                  title={HAIR_COLOR_NAMES[color]}
                  disabled={busy}
                  onClick={() => pick({ hairColor: i })}
                />
              ))}
            </Group>
            <Group label="Accessoire">
              {CHARACTER_ACCESSORIES.map((acc, i) => (
                <button
                  key={acc}
                  type="button"
                  className="chip"
                  aria-pressed={spec.accessory === i}
                  disabled={busy}
                  onClick={() => pick({ accessory: i })}
                >
                  {ACCESSORY_NAMES[acc]}
                </button>
              ))}
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
