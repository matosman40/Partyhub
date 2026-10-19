import { useState } from 'react';

/**
 * Écrans de {{name}} : réglages (salon), écran principal (TV ou ordinateur) et téléphone du joueur.
 * Chaque écran reçoit l'état produit par src/server.ts. Le choix des autres n'apparaît qu'au lancer.
 */

type Side = 'pile' | 'face';
type Send = (type: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>;

interface PublicView {
  phase: 'pick' | 'reveal' | 'final';
  round: number;
  rounds: number;
  players: Record<string, string>;
  points: Record<string, number>;
  result: Side | null;
  answered: string[];
}

interface PlayerView {
  phase: string;
  yourChoice: Side | null;
  result: Side | null;
  points: number;
}

interface HostView extends PublicView {
  choices: Record<string, Side> | null;
}

function Settings({
  settings,
  disabled,
  onChange,
}: {
  settings: Record<string, unknown>;
  disabled: boolean;
  onChange: (settings: Record<string, unknown>) => void;
}) {
  const rounds = typeof settings.rounds === 'number' ? settings.rounds : 3;
  return (
    <label>
      Manches
      <input
        type="number"
        min={1}
        max={10}
        value={rounds}
        disabled={disabled}
        onChange={(event) => onChange({ ...settings, rounds: Number(event.target.value) })}
      />
    </label>
  );
}

function Host({ publicState }: { publicState: HostView }) {
  const v = publicState;
  const title = v.phase === 'final' ? 'Fin de partie' : `Manche ${v.round} sur ${v.rounds}`;
  const side = v.result === 'pile' ? 'Pile' : v.result === 'face' ? 'Face' : '?';
  return (
    <main style={{ textAlign: 'center', padding: 24 }}>
      <h1>{title}</h1>
      <p style={{ fontSize: '6rem', margin: 0 }}>🪙 {side}</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {Object.entries(v.points).map(([id, points]) => (
          <li key={id}>
            {v.players[id] ?? id} : {points}
          </li>
        ))}
      </ul>
    </main>
  );
}

function Player({ publicState, playerState, send }: { publicState: PublicView; playerState: PlayerView; send: Send }) {
  const [error, setError] = useState<string | null>(null);
  const open = publicState.phase === 'pick' && playerState.yourChoice === null;

  async function choose(choice: Side) {
    setError(null);
    const response = await send('choisir', { choice });
    if (!response.ok) setError(response.error ?? 'Choix refusé.');
  }

  return (
    <main style={{ textAlign: 'center', padding: 16 }}>
      <p>
        Manche {publicState.round} sur {publicState.rounds} · {playerState.points} point(s)
      </p>
      {open ? (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button type="button" onClick={() => void choose('pile')}>
            Pile
          </button>
          <button type="button" onClick={() => void choose('face')}>
            Face
          </button>
        </div>
      ) : (
        <p>{playerState.yourChoice ? `Votre choix : ${playerState.yourChoice}` : 'Attendez la manche suivante.'}</p>
      )}
      {playerState.result && <p>Résultat : {playerState.result}</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

export default { Settings, Host, Player };
