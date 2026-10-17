import { useState } from 'react';
import { CHARACTER_EXPRESSIONS, type CharacterSpec } from '@partyhub/shared';
import { api } from '../api.js';
import { EXPRESSION_NAMES } from '../profile/CharacterEditor.js';

/**
 * Expression au repos du personnage, réglée depuis la salle. Le choix est enregistré sur le profil :
 * la salle et l’écran le montrent tout de suite, et la prochaine entrée le retrouve.
 */
export function ExpressionRow({ character, token }: { character: CharacterSpec; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = character.expression ?? 0;

  async function pick(index: number) {
    if (index === current) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/profiles/me', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatarCharacter: { ...character, expression: index } }),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seat-expressions">
      <p className="seat-expressions-title">Expression de mon personnage</p>
      <div className="seat-expressions-choices" role="group" aria-label="Expression de mon personnage">
        {CHARACTER_EXPRESSIONS.map((key, index) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={current === index}
            disabled={busy}
            onClick={() => void pick(index)}
          >
            {EXPRESSION_NAMES[key]}
          </button>
        ))}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
