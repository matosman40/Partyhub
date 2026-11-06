import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { clampInt } from '../../common/client/numbers.js';

/** Thèmes proposés au lancement, dans l’ordre d’affichage. */
const THEMES_CHOISIS = ['Animaux', 'Monuments', 'Peintures', 'Pays', 'Littérature'] as const;

interface TirageDraft {
  rounds: number;
  guessSeconds: number;
  themes: string[];
  themeLibre?: string;
}

/** Réglages de Tirage surprise : nombre de manches, temps, et thèmes cochés. Le serveur valide les valeurs. */
export function TirageSettings({ settings, disabled, onChange }: SettingsProps) {
  const current = settings as unknown as TirageDraft;
  const [draft, setDraft] = useState<TirageDraft>(current);
  const signature = JSON.stringify(current);

  useEffect(() => {
    setDraft(JSON.parse(signature) as TirageDraft);
  }, [signature]);

  function commit(next: TirageDraft) {
    setDraft(next);
    onChange({ ...next });
  }

  function basculer(theme: string) {
    const deja = draft.themes.includes(theme);
    // Au moins un thème reste coché : une partie sans thème n'a aucune question.
    if (deja && draft.themes.length === 1) return;
    const themes = deja ? draft.themes.filter((t) => t !== theme) : [...draft.themes, theme];
    commit({ ...draft, themes: THEMES_CHOISIS.filter((t) => themes.includes(t)) });
  }

  return (
    <div className="settings">
      <label className="field">
        <span>Questions par partie</span>
        <input
          type="number"
          min={1}
          max={10}
          value={draft.rounds}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, rounds: Number(e.target.value) })}
          onBlur={() => commit({ ...draft, rounds: clampInt(draft.rounds, 1, 10) })}
        />
      </label>
      <label className="field">
        <span>Secondes pour répondre</span>
        <input
          type="number"
          min={20}
          max={180}
          value={draft.guessSeconds}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, guessSeconds: Number(e.target.value) })}
          onBlur={() => commit({ ...draft, guessSeconds: clampInt(draft.guessSeconds, 20, 180) })}
        />
      </label>
      <label className="field">
        <span>Thème libre (facultatif)</span>
        <input
          type="text"
          maxLength={40}
          placeholder="ex. fleuves"
          value={draft.themeLibre ?? ''}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, themeLibre: e.target.value })}
          onBlur={() => commit({ ...draft, themeLibre: (draft.themeLibre ?? '').trim() })}
        />
        <small className="muted">
          Les questions viennent de Wikidata et portent sur les pays. Vide : les thèmes cochés.
        </small>
      </label>
      <fieldset className="field" disabled={disabled}>
        <legend>Thèmes</legend>
        {THEMES_CHOISIS.map((theme) => (
          <label key={theme} className="field-inline">
            <input type="checkbox" checked={draft.themes.includes(theme)} onChange={() => basculer(theme)} />
            <span>{theme}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
