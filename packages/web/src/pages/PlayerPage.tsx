import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PlayerSeat, readSeat, removeSeat, writeSeat } from '../seat/PlayerSeat.js';
import { sharedPlaceToken } from '../seat/share.js';
import { forgetDeviceProfile, type DeviceProfile } from '../profile/session.js';
import { useDeviceProfiles } from '../profile/useProfile.js';
import { CreateProfileForm } from '../profile/CreateProfileForm.js';
import { ProfileSwitcher } from '../profile/ProfileSwitcher.js';
import { DrawerSection } from '../components/CornerMenu.js';
import { DeviceChooser } from '../device/DeviceChooser.js';

/** Nombre maximal de joueurs qu'un même téléphone peut tenir. */
const MAX_SEATS = 6;

const seatListKey = (code: string) => `ph:seats:${code}`;
const seatProfilesKey = (code: string) => `ph:seatprofiles:${code}`;

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

/** Jeton du profil de chaque siège supplémentaire (le siège principal suit le profil actif). */
function readSeatProfiles(code: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(seatProfilesKey(code));
    const map = raw ? (JSON.parse(raw) as unknown) : null;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      return Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    }
  } catch {
    /* repli ci-dessous */
  }
  return {};
}

function writeSeatProfiles(code: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(seatProfilesKey(code), JSON.stringify(map));
  } catch {
    /* sans effet */
  }
}

/**
 * Interface joueur (smartphone). Un téléphone peut tenir plusieurs joueurs : chacun a sa place,
 * sa manette et son profil de l'appareil. Le siège principal suit le profil actif.
 */
export function PlayerPage() {
  const { code: rawCode = '' } = useParams();
  const code = rawCode.toUpperCase();
  const { active: activeProfile, list: profiles } = useDeviceProfiles();

  const [seats, setSeats] = useState<string[]>(() => readSeatList(code));
  const [seatTokens, setSeatTokens] = useState<Record<string, string>>(() => readSeatProfiles(code));
  const [active, setActive] = useState('main');
  const [labels, setLabels] = useState<Record<string, string | null>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingSeat, setCreatingSeat] = useState(false);

  /** Profil du siège : le principal suit le profil actif, les autres gardent celui choisi à leur ajout. */
  function profileOfSeat(id: string): DeviceProfile | null {
    if (id === 'main') return activeProfile;
    const token = seatTokens[id];
    return profiles.find((p) => p.token === token) ?? null;
  }

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

  // Un profil retiré de l'appareil libère son siège.
  useEffect(() => {
    const known = new Set(profiles.map((p) => p.token));
    const stale = seats.filter((id) => id !== 'main' && seatTokens[id] && !known.has(seatTokens[id]!));
    if (stale.length === 0) return;
    stale.forEach((id) => removeSeat(code, id));
    const next = seats.filter((id) => !stale.includes(id));
    const tokens = Object.fromEntries(Object.entries(seatTokens).filter(([id]) => !stale.includes(id)));
    setSeats(next);
    setSeatTokens(tokens);
    writeSeatList(code, next);
    writeSeatProfiles(code, tokens);
    if (!next.includes(active)) setActive('main');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  /** Ajoute un siège tenu par le profil donné. */
  function addSeatWith(token: string) {
    if (seats.length >= MAX_SEATS) return;
    const id = `seat-${Date.now().toString(36)}`;
    const next = [...seats, id];
    const tokens = { ...seatTokens, [id]: token };
    setSeats(next);
    setSeatTokens(tokens);
    writeSeatList(code, next);
    writeSeatProfiles(code, tokens);
    setActive(id);
    setPickerOpen(false);
    setCreatingSeat(false);
  }

  function dropSeat(id: string) {
    if (id === 'main') return;
    removeSeat(code, id);
    const next = seats.filter((s) => s !== id);
    const tokens = Object.fromEntries(Object.entries(seatTokens).filter(([k]) => k !== id));
    setSeats(next);
    setSeatTokens(tokens);
    writeSeatList(code, next);
    writeSeatProfiles(code, tokens);
    setActive('main');
  }

  function onIdentity(id: string, name: string | null) {
    setLabels((l) => (l[id] === name ? l : { ...l, [id]: name }));
  }

  // Profils encore libres pour un nouveau siège : ni le profil actif, ni ceux déjà à une place.
  const usedTokens = new Set([activeProfile?.token, ...Object.values(seatTokens)]);
  const candidates = profiles.filter((p) => !usedTokens.has(p.token));

  // Options de l'appareil : rangées dans le tiroir d'angle de chaque siège, hors de l'écran de jeu.
  const deviceMenu = (
    <>
      <DrawerSection title={`Salle ${code}`}>
        <Link className="link-btn" to="/join">
          Changer de salle
        </Link>
      </DrawerSection>
      <DrawerSection title="Mon profil sur cet appareil">
        <ProfileSwitcher />
      </DrawerSection>
      <DrawerSection title="Sur cet appareil">
        {seats.length < MAX_SEATS && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setPickerOpen(true);
              setCreatingSeat(false);
            }}
          >
            Ajouter un joueur sur cet appareil
          </button>
        )}
        {active !== 'main' && seats.includes(active) && (
          <button type="button" className="link-btn" onClick={() => dropSeat(active)}>
            Retirer ce joueur de l’appareil
          </button>
        )}
      </DrawerSection>
      <DrawerSection title="Micro et caméra">
        <DeviceChooser compact />
      </DrawerSection>
    </>
  );

  return (
    <main className="page player fade-in">
      <h1 className="sr-only">Salle {code}</h1>

      {pickerOpen && (
        <section className="card stack seat-picker" aria-label="Ajouter un joueur">
          <h2>Quel joueur ajouter ?</h2>
          {candidates.length > 0 ? (
            <ul className="profile-list">
              {candidates.map((p) => (
                <li key={p.id}>
                  <button type="button" className="chip" onClick={() => addSeatWith(p.token)}>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Tous les profils de cet appareil ont déjà une place.</p>
          )}
          {creatingSeat ? (
            <CreateProfileForm
              title="Nouveau joueur"
              activate={false}
              onCreated={(_profile, token) => addSeatWith(token)}
            />
          ) : (
            <button type="button" className="link-btn" onClick={() => setCreatingSeat(true)}>
              + Nouveau profil pour ce joueur
            </button>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setPickerOpen(false);
              setCreatingSeat(false);
            }}
          >
            Annuler
          </button>
        </section>
      )}

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

      {seats.map((id) => {
        const prof = profileOfSeat(id);
        return (
          <PlayerSeat
            // Changer de profil remonte le siège : il rejoint la salle sous sa nouvelle identité.
            key={`${id}:${prof?.id ?? 'sans-profil'}`}
            code={code}
            seatId={id}
            hidden={id !== active}
            profileToken={prof?.token ?? null}
            profileName={prof?.name ?? null}
            profileId={prof?.id ?? null}
            deviceMenu={deviceMenu}
            onIdentity={onIdentity}
            onProfileRejected={prof ? () => forgetDeviceProfile(prof.token) : undefined}
          />
        );
      })}
    </main>
  );
}
