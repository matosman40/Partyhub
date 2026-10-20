import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { defaultCharacterFor, type ProfileView } from '@partyhub/shared';
import { api } from '../api.js';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import {
  activeDeviceProfile,
  authHeaders,
  forgetDeviceProfile,
  readProfileToken,
  rememberDeviceProfile,
  renameDeviceProfile,
  replaceActiveToken,
} from '../profile/session.js';
import { useActiveProfile } from '../profile/useProfile.js';
import { CreateProfileForm } from '../profile/CreateProfileForm.js';
import { ProfileSwitcher } from '../profile/ProfileSwitcher.js';
import { fileToAvatarDataUrl } from '../profile/avatarImage.js';
import { WebcamPhoto, webcamAvailable } from '../profile/WebcamPhoto.js';
import { CharacterEditor } from '../profile/CharacterEditor.js';
import { DeviceChooser } from '../device/DeviceChooser.js';
import { useMusicSlot } from '../sounds.js';
import { ProposeBoumCard } from '../profile/ProposeBoumCard.js';
import { VoicesSection } from '../profile/VoicesSection.js';

/**
 * Profil : compte réutilisable d’un appareil à l’autre. Le profil garde le pseudo,
 * l’image, l’avatar et les statistiques ; on se reconnecte pour les retrouver.
 */

interface Session {
  profile: ProfileView;
}

export function ProfilePage() {
  useMusicSlot('menus');
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(readProfileToken() !== null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Le profil actif peut changer depuis le sélecteur : la page suit.
  const active = useActiveProfile();

  useEffect(() => {
    if (!active) {
      setSession(null);
      setChecking(false);
      return;
    }
    let alive = true;
    api<Session>('/api/profiles/me', { headers: authHeaders() })
      .then((r) => {
        if (alive) setSession(r);
      })
      .catch((err: Error & { status?: number }) => {
        // Seule une session refusée retire le profil de l’appareil ; une panne réseau ne le fait pas.
        if (alive && err.status === 401) forgetDeviceProfile(active.token);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.token]);

  /** Lance une action et affiche son résultat. Renvoie vrai seulement si elle a réussi. */
  async function run<T>(action: () => Promise<T>, done?: (value: T) => string | null): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const value = await action();
      const text = done ? done(value) : null;
      if (text) setMessage({ ok: true, text });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const r = await api<Session>('/api/profiles/me', { headers: authHeaders() });
    setSession(r);
  }

  if (checking) {
    return (
      <main className="page center">
        <p>Vérification du profil…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="page fade-in" style={{ maxWidth: 560 }}>
        <p className="page-nav">
          <Breadcrumb items={[{ label: 'Accueil', to: '/' }, { label: 'Mon profil' }]} />
        </p>
        <CreateProfileForm
          title="Créer mon profil"
          onCreated={(created) => {
            setSession({ profile: created });
            setMessage({ ok: true, text: 'Profil créé. Bienvenue !' });
          }}
        />

        <details className="card" style={{ marginTop: '1rem' }}>
          <summary>J’ai un ancien compte avec mot de passe</summary>
          <AuthForm
            key="login"
            busy={busy}
            submitLabel="Se connecter"
            onSubmit={(values) =>
              run(
                () =>
                  api<{ token: string; profile: ProfileView }>('/api/profiles/login', {
                    method: 'POST',
                    body: JSON.stringify({ username: values.username, password: values.password }),
                  }),
                (r) => {
                  rememberDeviceProfile({ token: r.token, id: r.profile.id, name: r.profile.displayName });
                  void reload();
                  return 'Connecté.';
                },
              )
            }
          />
        </details>

        {message && (
          <p className={message.ok ? 'notice' : 'error'} role="status">
            {message.text}
          </p>
        )}
      </main>
    );
  }

  const { profile } = session;
  const perGame = profile.stats.perGame;

  return (
    <main className="page fade-in profile-page" style={{ maxWidth: 760 }}>
      <p className="page-nav">
        <Breadcrumb items={[{ label: 'Accueil', to: '/' }, { label: 'Mon profil' }]} />
        <Link to="/join">Rejoindre une salle</Link>
      </p>

      <ProfileSwitcher />

      <section className="card profile-hero" aria-labelledby="profile-title">
        <PlayerAvatar avatar={profile.avatar} name={profile.displayName} size="lg" highlight />
        <div>
          <h1 id="profile-title" style={{ fontSize: 'clamp(1.8rem, 5vw, 2.6rem)' }}>
            {profile.displayName}
          </h1>
          <p className="muted small">
            {profile.hasPassword && <>@{profile.username} · </>}membre depuis le{' '}
            {new Date(profile.createdAt).toLocaleDateString('fr-FR')}
          </p>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              // Sans mot de passe, retirer le profil de l’appareil le rend inaccessible : on le demande.
              if (
                !profile.hasPassword &&
                !window.confirm(
                  `Retirer « ${profile.displayName} » de cet appareil ? Sans mot de passe, ce profil ne pourra plus être rouvert.`,
                )
              )
                return;
              void api('/api/profiles/logout', { method: 'POST', headers: authHeaders() }).catch(() => undefined);
              const current = activeDeviceProfile();
              if (current) forgetDeviceProfile(current.token);
              setSession(null);
            }}
          >
            {profile.hasPassword ? 'Se déconnecter de cet appareil' : 'Retirer de cet appareil'}
          </button>
        </div>
      </section>

      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}

      <nav className="profile-nav" aria-label="Rubriques du profil">
        <a className="chip" href="#stats">
          Statistiques
        </a>
        <a className="chip" href="#personnage">
          Personnage
        </a>
        <a className="chip" href="#pseudo">
          Pseudo
        </a>
        <a className="chip" href="#appareil">
          Micro et caméra
        </a>
        {profile.hasPassword && (
          <a className="chip" href="#mot-de-passe">
            Mot de passe
          </a>
        )}
        <a className="chip" href="#voix">
          Voix
        </a>
        <a className="chip" href="#boum">
          BOUM !
        </a>
        <a className="chip" href="#supprimer">
          Supprimer
        </a>
      </nav>

      <section id="stats" className="card stack" aria-labelledby="stats-title">
        <h2 id="stats-title">Statistiques</h2>
        <div className="stats-row">
          <div>
            <span className="big-number">{profile.stats.played}</span>
            <span className="muted">parties</span>
          </div>
          <div>
            <span className="big-number">{profile.stats.wins}</span>
            <span className="muted">victoires</span>
          </div>
          <div>
            <span className="big-number">{profile.stats.points}</span>
            <span className="muted">points</span>
          </div>
        </div>
        {perGame.length > 0 ? (
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">Jeu</th>
                <th scope="col">Parties</th>
                <th scope="col">Victoires</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {perGame.map((g) => (
                <tr key={g.gameId}>
                  <td>{g.name}</td>
                  <td>{g.played}</td>
                  <td>{g.wins}</td>
                  <td>{g.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Pas encore de partie. Lancez-en une : les résultats seront gardés ici.</p>
        )}
        <p className="muted small">Les parties d’entraînement avec des robots ne comptent pas.</p>
      </section>

      <AvatarSection
        profile={profile}
        busy={busy}
        onChange={(patch) =>
          run(
            () =>
              api<{ profile: ProfileView }>('/api/profiles/me', {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify(patch),
              }),
            () => {
              void reload();
              return 'Avatar enregistré.';
            },
          )
        }
      />

      <section id="pseudo" className="card stack" aria-labelledby="name-title">
        <h2 id="name-title">Pseudo affiché</h2>
        <NameForm
          current={profile.displayName}
          busy={busy}
          onSave={(displayName) =>
            run(
              () =>
                api('/api/profiles/me', {
                  method: 'PUT',
                  headers: authHeaders(),
                  body: JSON.stringify({ displayName }),
                }),
              () => {
                renameDeviceProfile(profile.id, displayName);
                void reload();
                return 'Pseudo enregistré.';
              },
            )
          }
        />
      </section>

      <section id="appareil" className="card stack" aria-labelledby="devices-title">
        <h2 id="devices-title">Micro et caméra</h2>
        <p className="muted small">
          Ce choix vaut pour cet appareil, pas pour le compte : il s’applique à tous les jeux qui utilisent le micro ou
          la caméra.
        </p>
        <DeviceChooser />
      </section>

      {profile.hasPassword && (
        <section id="mot-de-passe" className="card stack" aria-labelledby="password-title">
          <h2 id="password-title">Mot de passe</h2>
          <PasswordForm
            busy={busy}
            onSave={(current, next) =>
              run(
                () =>
                  api<{ token: string }>('/api/profiles/me/password', {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ current, next }),
                  }),
                (r) => {
                  replaceActiveToken(r.token);
                  return 'Mot de passe changé. Vos autres appareils devront se reconnecter.';
                },
              )
            }
          />
        </section>
      )}

      <div id="voix">
        <VoicesSection />
      </div>

      <section id="boum" className="card stack" aria-labelledby="boum-title">
        <h2 id="boum-title">Proposer une carte pour BOUM !</h2>
        <ProposeBoumCard />
      </section>

      <section id="supprimer" className="card stack danger-zone" aria-labelledby="delete-title">
        <h2 id="delete-title">Supprimer le profil</h2>
        <p className="muted">Le profil, ses statistiques et son image sont effacés. Cette action est définitive.</p>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                `Supprimer définitivement « ${profile.displayName} » ? Le profil, ses statistiques et son image seront effacés. Cette action est irréversible.`,
              )
            )
              return;
            const deleted = await run(
              () => api('/api/profiles/me', { method: 'DELETE', headers: authHeaders() }),
              () => null,
            );
            // Un échec laisse le profil en place : le message d’erreur est déjà affiché.
            if (!deleted) return;
            const removed = activeDeviceProfile();
            if (removed) forgetDeviceProfile(removed.token);
            // S’il reste un autre profil sur l’appareil, la page le charge toute seule (effet ci-dessus).
            setSession(null);
            setMessage({ ok: true, text: 'Profil supprimé.' });
          }}
        >
          Supprimer mon profil
        </button>
      </section>
    </main>
  );
}

function AuthForm({
  busy,
  submitLabel,
  withName = false,
  onSubmit,
}: {
  busy: boolean;
  submitLabel: string;
  withName?: boolean;
  onSubmit: (values: { username: string; password: string; displayName: string }) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ username: username.trim().toLowerCase(), password, displayName: displayName.trim() });
  }

  return (
    <form className="stack card" onSubmit={submit}>
      <label className="field">
        <span>Identifiant</span>
        <input
          value={username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          onChange={(e) => setUsername(e.target.value)}
          aria-describedby="username-help"
        />
        <span id="username-help" className="muted small">
          3 à 20 caractères : lettres sans accent, chiffres ou _.
        </span>
      </label>
      {withName && (
        <label className="field">
          <span>Pseudo affiché</span>
          <input
            value={displayName}
            maxLength={16}
            autoComplete="nickname"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      )}
      <label className="field">
        <span>Mot de passe</span>
        <input
          type="password"
          value={password}
          autoComplete={withName ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-help"
        />
        {withName && (
          <span id="password-help" className="muted small">
            8 caractères minimum.
          </span>
        )}
      </label>
      <button
        type="submit"
        className="btn primary big"
        disabled={busy || !username || !password || (withName && !displayName)}
      >
        {busy ? 'Un instant…' : submitLabel}
      </button>
    </form>
  );
}

function AvatarSection({
  profile,
  busy,
  onChange,
}: {
  profile: ProfileView;
  busy: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [webcamOpen, setWebcamOpen] = useState(false);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      onChange({ avatarImage: dataUrl });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section id="personnage" className="card stack" aria-labelledby="avatar-title">
      <h2 id="avatar-title">Mon personnage</h2>
      <div className="profile-hero">
        <PlayerAvatar avatar={profile.avatar} name={profile.displayName} size="lg" />
        <div className="stack" style={{ flex: 1, minWidth: 220 }}>
          {webcamOpen ? (
            <WebcamPhoto
              onCapture={(dataUrl) => {
                setWebcamOpen(false);
                setError(null);
                onChange({ avatarImage: dataUrl });
              }}
              onCancel={() => setWebcamOpen(false)}
            />
          ) : (
            <>
              <label className="field">
                <span>Choisir une photo</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => void pickFile(e.target.files?.[0])}
                />
              </label>
              {webcamAvailable() ? (
                <button type="button" className="btn ghost small" disabled={busy} onClick={() => setWebcamOpen(true)}>
                  Prendre une photo avec la webcam
                </button>
              ) : (
                <p className="muted small">La webcam ne s’ouvre que sur une connexion sécurisée (https).</p>
              )}
              {profile.avatar.imageUrl && (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => onChange({ avatarImage: null })}
                >
                  Retirer la photo
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {profile.avatar.imageUrl && (
        <div className="consent-box">
          <label className="consent-check">
            <input
              type="checkbox"
              checked={profile.avatarShared}
              disabled={busy}
              onChange={(e) => onChange({ avatarShared: e.target.checked })}
            />
            <span>Afficher ma photo aux autres joueurs pendant les parties</span>
          </label>
          <p className="muted small">
            {profile.avatarShared
              ? 'Les autres joueurs de la salle voient votre photo, sur l’écran et sur leur téléphone. Décochez pour revenir à votre personnage.'
              : 'Pour l’instant, les autres joueurs voient votre personnage. Votre photo reste privée : vous seul(e) la voyez.'}
          </p>
        </div>
      )}
      <p className="muted small">
        Sans photo, c’est votre personnage qui vous représente, sur la couleur de fond choisie plus bas.
      </p>
      <CharacterEditor
        spec={profile.avatar.character ?? defaultCharacterFor(profile.username)}
        busy={busy}
        onChange={(spec) => onChange({ avatarCharacter: spec })}
      />
      <button
        type="button"
        className="btn ghost small"
        disabled={busy}
        onClick={() => onChange({ avatarCharacter: null })}
      >
        Personnage automatique (d’après mon identifiant)
      </button>
      <label className="field">
        <span>Couleur de fond de l’avatar : {profile.avatar.hue}°</span>
        <input
          type="range"
          min={0}
          max={359}
          value={profile.avatar.hue}
          disabled={busy}
          onChange={(e) => onChange({ avatarHue: Number(e.target.value) })}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function NameForm({
  current,
  busy,
  onSave,
}: {
  current: string;
  busy: boolean;
  onSave: (displayName: string) => void;
}) {
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value.trim());
      }}
    >
      <label className="field">
        <span>Pseudo affiché dans les salles</span>
        <input value={value} maxLength={16} autoComplete="nickname" onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="submit" className="btn small" disabled={busy || !value.trim() || value.trim() === current}>
        Enregistrer le pseudo
      </button>
    </form>
  );
}

function PasswordForm({ busy, onSave }: { busy: boolean; onSave: (current: string, next: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(current, next);
        setCurrent('');
        setNext('');
      }}
    >
      <label className="field">
        <span>Mot de passe actuel</span>
        <input
          type="password"
          value={current}
          autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Nouveau mot de passe</span>
        <input type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
      </label>
      <button type="submit" className="btn small" disabled={busy || !current || next.length < 8}>
        Changer le mot de passe
      </button>
    </form>
  );
}
