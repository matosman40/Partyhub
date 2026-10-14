import { useEffect, useState } from 'react';
import type { SettingsProps } from '../../client/types.js';

interface QuizDraft {
  questionCount: number;
  answerSeconds: number;
  speedBonus: boolean;
}

/**
 * Réglages de Quiz Party. Les valeurs saisies sont validées par le serveur :
 * le navigateur n'est qu'un confort de saisie.
 */
export function QuizSettings({ settings, disabled, onChange }: SettingsProps) {
  const current = settings as unknown as QuizDraft;
  const [draft, setDraft] = useState<QuizDraft>(current);

  useEffect(() => {
    setDraft(current);
  }, [current.questionCount, current.answerSeconds, current.speedBonus]);

  function commit(next: QuizDraft) {
    setDraft(next);
    onChange({ ...next });
  }

  return (
    <div className="settings">
      <label className="field">
        <span>Questions</span>
        <input
          type="number"
          min={1}
          max={20}
          value={draft.questionCount}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, questionCount: Number(e.target.value) })}
          onBlur={() => commit(draft)}
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
          onBlur={() => commit(draft)}
        />
      </label>
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
