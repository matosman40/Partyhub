import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { PlayerSeat, readSeat, removeSeat, writeSeat } from '../seat/PlayerSeat.js';
import { sharedPlaceToken } from '../seat/share.js';
import { readProfileToken, clearProfileToken, authHeaders } from '../profile/session.js';

/** Nombre maximal de joueurs qu'un même téléphone peut tenir. */
const MAX_SEATS = 6;

const seatListKey = (code: string) => `ph:seats:${code}`;

function readSeatList(code: string): string[] {
  try {
    const raw = localStorage.getItem(seatListKey(code));
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.length > 0 && list.every((x) => typeof x === 'string')) {
      return (list as string[]).slice(0, MAX_SEATS);
    }
  } catch {
    /* repli ci-dessous */
  }
  return ['main'];
}

function writeSeatList(code: string, list: string[]): void {
  try {
    localStorage.setItem(seatListKey(code), JSON.stringify(list));
  } catch {
    /* sans effet : les sièges supplémentaires ne survivront pas au rechargement */
  }
}

/**
 * Interface joueur (smartphone). Un téléphone peut tenir plusieurs joueurs
 * (« ajouter un joueur sur cet appareil ») ; chacun a sa place et sa manette.
 * Un joueur connecté à son profil entre sous ce profil.
 */
export function PlayerPage() {
  const { code: rawCode = '' } = useParams();
  const code = rawCode.toUpperCase();

  const [seats, setSeats] = useState<string[]>(() => readSeatList(code));
  const [active, setActive] = useState('main');
  const [labels, setLabels] = useState<Record<string, string | null>>({});
  const [profileToken, setProfileToken] = useState<string | null>(() => readProfileToken());
  const [profileName, setProfileName] = useState<string | null>(null);

  useEffect(() => {
    if (!profileToken) return;
    api<{ profile: { displayName: string } }>('/api/profiles/me', { headers: authHeaders() })
      .then((r) => setProfileName(r.profile.displayName))
      .catch(() => {
        clearProfileToken();
        setProfileToken(null);
      });
    // Le profil est relu une fois à l'ouverture de la page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Lien « jouer sur un autre appareil » : cette page reçoit la place d'un autre téléphone.
    const token = sharedPlaceToken(window.location.hash);
    if (token) {
      const current = readSeatList(code);
      if (current.length < MAX_SEATS) {
        const id = `seat-${Date.now().toString(36)}`;
        writeSeat(code, id, { token, name: 'Joueur' });
        const next = [...current, id];
        writeSeatList(code, next);
        setSeats(next);
        setActive(id);
      }
      // Le jeton ne reste pas dans l'adresse (historique, copie d'écran).
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // Les sièges déjà joués sur cet appareil retrouvent leur place sans rien demander.
    for (const id of seats) {
      if (readSeat(code, id) && !labels[id]) {
        setLabels((l) => ({ ...l, [id]: readSeat(code, id)?.name ?? null }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function addSeat() {
    if (seats.length >= MAX_SEATS) return;
    const id = `seat-${Date.now().toString(36)}`;
    const next = [...seats, id];
    setSeats(next);
    writeSeatList(code, next);
    setActive(id);
  }

  function dropSeat(id: string) {
    if (id === 'main') return;
    removeSeat(code, id);
    const next = seats.filter((s) => s !== id);
    setSeats(next);
    writeSeatList(code, next);
    setActive('main');
  }

  function onIdentity(id: string, name: string | null) {
    setLabels((l) => (l[id] === name ? l : { ...l, [id]: name }));
  }

  const profileRejected = () => {
    clearProfileToken();
    setProfileToken(null);
    setProfileName(null);
  };

  return (
    <main className="page player fade-in">
      <header className="page-nav">
        <h1 style={{ fontSize: 'clamp(1.6rem, 5vw, 2.4rem)', margin: 0 }}>Salle {code}</h1>
        <Link to="/join">Changer de salle</Link>
      </header>

      {seats.length > 1 && (
        <nav className="seat-tabs" aria-label="Joueurs sur cet appareil">
          {seats.map((id, i) => {
            const label = labels[id] ?? `Joueur ${i + 1}`;
            return (
              <button
                key={id}
                type="button"
                className={`chip${active === id ? ' active' : ''}`}
                aria-pressed={active === id}
                onClick={() => setActive(id)}
              >
                {label}
              </button>
            );
          })}
        </nav>
      )}

      {seats.map((id) => (
        <PlayerSeat
          key={id}
          code={code}
          seatId={id}
          hidden={id !== active}
          profileToken={id === 'main' ? profileToken : null}
          profileName={id === 'main' ? profileName : null}
          onIdentity={onIdentity}
          onProfileRejected={id === 'main' ? profileRejected : undefined}
        />
      ))}

      <div className="stack">
        {seats.length < MAX_SEATS && (
          <button type="button" className="link-btn" onClick={addSeat}>
            Ajouter un joueur sur cet appareil
          </button>
        )}
        {active !== 'main' && seats.includes(active) && (
          <button type="button" className="link-btn" onClick={() => dropSeat(active)}>
            Retirer ce joueur de l’appareil
          </button>
        )}
        {!profileToken && (
          <p className="muted small">
            Aucun compte nécessaire. <Link to="/profil">Créer un profil</Link> pour garder votre image et vos
            statistiques.
          </p>
        )}
      </div>
    </main>
  );
}
