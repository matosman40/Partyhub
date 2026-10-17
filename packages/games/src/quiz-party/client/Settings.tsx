import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';
import { clampInt } from '../../common/client/numbers.js';

interface QuizDraft {
  source: 'curated' | 'players';
  questionCount: number;
  answerSeconds: number;
  topicSeconds: number;
  speedBonus: boolean;
}

/**
 * Réglages de Quiz Party. Les valeurs saisies sont validées par le serveur :
 * le navigateur n’est qu’un confort de saisie, et borne les nombres à la perte de focus.
 */
export function QuizSettings({ settings, disabled, onChange }: SettingsProps) {
  const current = settings as unknown as QuizDraft;
  const [draft, setDraft] = useState<QuizDraft>(current);
  // Le brouillon se recale sur les réglages du serveur quand ils changent (comparaison par valeur).
  const signature = JSON.stringify(current);

  useEffect(() => {
    setDraft(JSON.parse(signature) as QuizDraft);
  }, [signature]);

  function commit(next: QuizDraft) {
    setDraft(next);
    onChange({ ...next });
  }

  const fromPlayers = draft.source === 'players';

  return (
    <div className="settings">
      <label className="field">
        <span>Source des questions</span>
        <select
          value={draft.source}
          disabled={disabled}
          onChange={(e) => commit({ ...draft, source: e.target.value as QuizDraft['source'] })}
        >
          <option value="curated">Questions intégrées</option>
          <option value="players">Thèmes des joueurs (IA)</option>
        </select>
      </label>
      <label className="field">
        <span>Questions</span>
        <input
          type="number"
          min={1}
          max={20}
          value={draft.questionCount}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, questionCount: Number(e.target.value) })}
          onBlur={() => commit({ ...draft, questionCount: clampInt(draft.questionCount, 1, 20) })}
        />
      </label>
      <label className="field">
        <span>Secondes par question</span>
        <input
          type="number"
          min={5}
          max={60}
          value={draft.answerSeconds}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, answerSeconds: Number(e.target.value) })}
          onBlur={() => commit({ ...draft, answerSeconds: clampInt(draft.answerSeconds, 5, 60) })}
        />
      </label>
      {fromPlayers && (
        <label className="field">
          <span>Secondes pour les mots-clés, par joueur</span>
          <input
            type="number"
            min={10}
            max={60}
            value={draft.topicSeconds}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, topicSeconds: Number(e.target.value) })}
            onBlur={() => commit({ ...draft, topicSeconds: clampInt(draft.topicSeconds, 10, 60) })}
          />
        </label>
      )}
      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.speedBonus}
          disabled={disabled}
          onChange={(e) => commit({ ...draft, speedBonus: e.target.checked })}
        />
        <span>Bonus de rapidité</span>
      </label>
    </div>
  );
}
