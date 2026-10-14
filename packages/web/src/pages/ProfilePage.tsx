import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { defaultCharacterFor, type ProfileView } from '@partyhub/shared';
import { api } from '../api.js';
import { PlayerAvatar } from '../components/PlayerAvatar.js';
import { authHeaders, clearProfileToken, readProfileToken, saveProfileToken } from '../profile/session.js';
import { fileToAvatarDataUrl } from '../profile/avatarImage.js';
import { CharacterEditor } from '../profile/CharacterEditor.js';

/**
 * Profil : compte réutilisable d'un appareil à l'autre. Le profil garde le pseudo,
 * l'image, l'avatar et les statistiques ; on se reconnecte pour les retrouver.
 */

type Mode = 'login' | 'register';

interface Session {
  profile: ProfileView;
}

export function ProfilePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(readProfileToken() !== null);
  const [mode, setMode] = useState<Mode>('login');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!readProfileToken()) return;
    api<Session>('/api/profiles/me', { headers: authHeaders() })
      .then((r) => setSession(r))
      .catch(() => {
        clearProfileToken();
        setSession(null);
      })
      .finally(() => setChecking(false));
  }, []);

  async function run<T>(action: () => Promise<T>, done?: (value: T) => string | null): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const value = await action();
      const text = done ? done(value) : null;
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
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
          <Link to="/">Accueil</Link>
        </p>
        <h1>{mode === 'register' ? 'Créer un profil' : 'Se connecter'}</h1>
        <p className="muted">
          Le profil garde votre pseudo, votre image et vos statistiques. Un identifiant et un mot de passe suffisent.
        </p>

        <nav className="filters" aria-label="Choix du formulaire">
          <button
            type="button"
            className={`chip${mode === 'login' ? ' active' : ''}`}
            aria-pressed={mode === 'login'}
            onClick={() => setMode('login')}
          >
            J’ai déjà un profil
          </button>
          <button
            type="button"
            className={`chip${mode === 'register' ? ' active' : ''}`}
            aria-pressed={mode === 'register'}
            onClick={() => setMode('register')}
          >
            Créer un profil
          </button>
        </nav>

        {mode === 'login' ? (
          <AuthForm
            key="login"
            busy={busy}
            submitLabel="Se connecter"
            onSubmit={(values) =>
              run(
                () =>
                  api<{ token: string }>('/api/profiles/login', {
                    method: 'POST',
                    body: JSON.stringify({ username: values.username, password: values.password }),
                  }),
                (r) => {
                  saveProfileToken(r.token);
                  void reload();
                  return 'Connecté.';
                },
              )
            }
          />
        ) : (
          <AuthForm
            key="register"
            busy={busy}
            submitLabel="Créer le profil"
            withName
            onSubmit={(values) =>
              run(
                () =>
                  api<{ token: string }>('/api/profiles/register', {
                    method: 'POST',
                    body: JSON.stringify({
                      username: values.username,
                      password: values.password,
                      displayName: values.displayName,
                    }),
                  }),
                (r) => {
                  saveProfileToken(r.token);
                  void reload();
                  return 'Profil créé. Bienvenue !';
                },
              )
            }
          />
        )}

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
    <main className="page fade-in" style={{ maxWidth: 760 }}>
      <p className="page-nav">
        <Link to="/">Accueil</Link>
        <Link to="/join">Rejoindre une salle</Link>
      </p>

      <section className="card profile-hero" aria-labelledby="profile-title">
        <PlayerAvatar avatar={profile.avatar} name={profile.displayName} size="lg" highlight />
        <div>
          <h1 id="profile-title" style={{ fontSize: 'clamp(1.8rem, 5vw, 2.6rem)' }}>
            {profile.displayName}
          </h1>
          <p className="muted small">
            @{profile.username} · membre depuis le {new Date(profile.createdAt).toLocaleDateString('fr-FR')}
          </p>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              void api('/api/profiles/logout', { method: 'POST', headers: authHeaders() }).catch(() => undefined);
              clearProfileToken();
              setSession(null);
              setMode('login');
            }}
          >
            Se déconnecter
          </button>
        </div>
      </section>

      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}

      <section className="card stack" aria-labelledby="stats-title">
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

      <section className="card stack" aria-labelledby="name-title">
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
                void reload();
                return 'Pseudo enregistré.';
              },
            )
          }
        />
      </section>

      <section className="card stack" aria-labelledby="password-title">
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
                saveProfileToken(r.token);
                return 'Mot de passe changé. Vos autres appareils devront se reconnecter.';
              },
            )
          }
        />
      </section>

      <section className="card stack danger-zone" aria-labelledby="delete-title">
        <h2 id="delete-title">Supprimer le profil</h2>
        <p className="muted">Le profil, ses statistiques et son image sont effacés. Cette action est définitive.</p>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Supprimer définitivement ce profil ?')) return;
            void run(
              () => api('/api/profiles/me', { method: 'DELETE', headers: authHeaders() }),
              () => null,
            ).then(() => {
              clearProfileToken();
              setSession(null);
              setMode('login');
              setMessage({ ok: true, text: 'Profil supprimé.' });
            });
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
    <section className="card stack" aria-labelledby="avatar-title">
      <h2 id="avatar-title">Mon personnage</h2>
      <div className="profile-hero">
        <PlayerAvatar avatar={profile.avatar} name={profile.displayName} size="lg" />
        <div className="stack" style={{ flex: 1, minWidth: 220 }}>
          <label className="field">
            <span>Choisir une photo</span>
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
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
