import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEVICE_KIND_ICONS, type CatalogGame, type DeviceKind } from '@partyhub/shared';
import { DEFAULT_TEST_MODE, TEST_MODE_FACTORS, testModeLabel, type TestMode } from '@partyhub/shared';
import { api } from '../api.js';
import { openRoomsText } from '../admin/messages.js';
import { CardGamesAdmin } from '../admin/CardGamesAdmin.js';
import { BoardGamesAdmin } from '../admin/BoardGamesAdmin.js';
import { PackagesAdmin } from '../admin/PackagesAdmin.js';
import { PackageSourcesAdmin } from '../admin/PackageSourcesAdmin.js';
import { CharacterPacksAdmin } from '../admin/CharacterPacksAdmin.js';
import { AssetLibrary } from '../admin/AssetLibrary.js';
import { ScreenBackgroundsAdmin } from '../admin/ScreenBackgroundsAdmin.js';
import { SoundSettingsAdmin } from '../admin/SoundSettingsAdmin.js';
import { BoumBanksAdmin } from '../admin/BoumBanksAdmin.js';
import { MediaGamesAdmin } from '../admin/MediaGamesAdmin.js';
import { GameDetailsEditor } from '../admin/GameDetailsEditor.js';
import { GameSettingsEditor } from '../admin/GameSettingsEditor.js';
import { viewsFor } from '../games.js';
import { BackupPanel } from '../admin/BackupPanel.js';
import { DbBackups } from '../admin/DbBackups.js';
import { BackButton } from '../components/BackButton.js';
import { LogsAdmin } from '../admin/LogsAdmin.js';
import { AiSettingsAdmin } from '../admin/AiSettingsAdmin.js';

const ORIGIN_LABEL: Record<CatalogGame['origin'], string | null> = {
  builtin: null,
  cards: 'Cartes',
  media: 'Questions médias',
  board: 'Plateau',
  package: 'Paquet importé',
};

interface AdminSettings {
  maxPlayers: number;
  graceSeconds: number;
  inactivityMinutes: number;
  maxRoomAgeMinutes: number;
  roomCodeLength: number;
}

interface RoomSummary {
  code: string;
  gameName: string;
  status: string;
  players: number;
  connected: number;
  hostConnected: boolean;
  observers: number;
  devices: Record<string, number>;
  lastActivity: string;
}

/** Résume les types d'appareils d'une salle, par exemple « 📱 2 · 💻 1 ». */
function deviceSummary(devices: Record<string, number>): string {
  const parts = Object.entries(devices)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${DEVICE_KIND_ICONS[kind as DeviceKind] ?? '❔'} ${count}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

interface Overview {
  settings: AdminSettings;
  games: CatalogGame[];
  rooms: RoomSummary[];
  stats: Record<string, number>;
  uptimeSec: number;
}

const STATUS_LABEL: Record<string, string> = {
  waiting: 'En attente',
  full: 'Complète',
  in_game: 'En cours',
  ended: 'Terminée',
};

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page center fade-in">
      <h1>Administration</h1>
      <form className="stack" onSubmit={submit}>
        <label className="field big-field">
          <span>Mot de passe</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </label>
        <button type="submit" className="btn primary big" disabled={busy || !password}>
          Se connecter
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <BackButton to="/">Retour à l’accueil</BackButton>
    </main>
  );
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** Notice d'un jeu : but, étapes (une par ligne), astuces. Restauration de la notice d'origine possible. */
function NoticeEditor({ game, onSaved }: { game: CatalogGame; onSaved: () => void }) {
  const [goal, setGoal] = useState(game.notice.goal);
  const [steps, setSteps] = useState(game.notice.steps.join('\n'));
  const [tips, setTips] = useState(game.notice.tips.join('\n'));
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const res = await api<{ openRooms: number }>(`/api/admin/notices/${encodeURIComponent(game.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ goal: goal.trim(), steps: lines(steps), tips: lines(tips) }),
      });
      setMessage(`Notice enregistrée. ${openRoomsText(res.openRooms)}`);
      onSaved();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function restore() {
    setMessage(null);
    try {
      await api(`/api/admin/notices/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
      setGoal(game.defaultNotice.goal);
      setSteps(game.defaultNotice.steps.join('\n'));
      setTips(game.defaultNotice.tips.join('\n'));
      setMessage('Notice d’origine restaurée.');
      onSaved();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <details className="notice-editor card">
      <summary>
        <span aria-hidden="true">{game.icon}</span> {game.name}{' '}
        {game.customNotice && <span className="badge">modifiée</span>}
      </summary>
      <form className="stack" onSubmit={save} style={{ marginTop: '1rem' }}>
        <label className="field">
          <span>But du jeu</span>
          <textarea rows={2} maxLength={400} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </label>
        <label className="field">
          <span>Étapes, une par ligne, dans l’ordre</span>
          <textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </label>
        <label className="field">
          <span>Astuces, une par ligne</span>
          <textarea rows={3} value={tips} onChange={(e) => setTips(e.target.value)} />
        </label>
        <div className="section-head">
          <button type="submit" className="btn primary">
            Enregistrer la notice
          </button>
          {game.customNotice && (
            <button type="button" className="btn ghost" onClick={restore}>
              Restaurer la notice d’origine
            </button>
          )}
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </form>
    </details>
  );
}

function SettingsForm({ settings, onSaved }: { settings: AdminSettings; onSaved: () => void }) {
  const [draft, setDraft] = useState<AdminSettings>(settings);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(draft) });
      setMessage({ ok: true, text: 'Réglages enregistrés.' });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  }

  const field = (key: keyof AdminSettings, label: string, min: number, max: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <form className="admin-form" onSubmit={save}>
      {field('maxPlayers', 'Joueurs maximum par salle (2–20)', 2, 20)}
      {field('graceSeconds', 'Délai de reconnexion, en secondes (10–600)', 10, 600)}
      {field('inactivityMinutes', 'Inactivité avant suppression, en minutes (5–1440)', 5, 1440)}
      {field('maxRoomAgeMinutes', 'Durée maximale d’une salle, en minutes (15–1440)', 15, 1440)}
      {field('roomCodeLength', 'Chiffres du code de salle (4–6) : les salles déjà ouvertes gardent leur code', 4, 6)}
      <button type="submit" className="btn primary">
        Enregistrer
      </button>
      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}

/** Mode test : un curseur de cadence pour essayer les émotions et les voix, sans toucher aux réglages habituels. */
function TestModeForm() {
  const [mode, setMode] = useState<TestMode>(DEFAULT_TEST_MODE);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ mode: TestMode }>('/api/test-mode')
      .then((res) => setMode(res.mode))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const step = Math.max(0, (TEST_MODE_FACTORS as readonly number[]).indexOf(mode.factor));

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const res = await api<{ mode: TestMode }>('/api/admin/test-mode', {
        method: 'PUT',
        body: JSON.stringify(mode),
      });
      setMode(res.mode);
      setMessage({
        ok: true,
        text: res.mode.enabled ? `Mode test actif : cadence ${testModeLabel(res.mode.factor)}.` : 'Mode test éteint.',
      });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <form className="admin-form" onSubmit={save}>
      <label className="field">
        <span>
          <input
            type="checkbox"
            checked={mode.enabled}
            onChange={(e) => setMode({ ...mode, enabled: e.target.checked })}
          />{' '}
          Mode test actif
        </span>
      </label>
      <label className="field">
        <span>Cadence des émotions et des voix : {testModeLabel(mode.factor)}</span>
        <input
          type="range"
          min={0}
          max={TEST_MODE_FACTORS.length - 1}
          step={1}
          value={step}
          aria-valuetext={testModeLabel(mode.factor)}
          onChange={(e) => setMode({ ...mode, factor: TEST_MODE_FACTORS[Number(e.target.value)] ?? 1 })}
        />
      </label>
      <p className="muted small">
        Normal : la cadence habituelle. Chaque palier la multiplie. Les joueurs connectés voient le bandeau « Mode test
        » sur le salon et le téléphone.
      </p>
      <button type="submit" className="btn primary" disabled={!loaded}>
        Enregistrer le mode test
      </button>
      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}

/** Rubriques du menu de l'administration. Le choix est dans l'adresse (?section=…) : le bouton précédent fonctionne. */
const ADMIN_CATEGORIES = [
  {
    id: 'salles',
    title: 'Salles et statistiques',
    text: 'Salles ouvertes, parties lancées, nettoyage des salles sans connexion.',
  },
  {
    id: 'jeux',
    title: 'Jeux',
    text: 'Activer ou désactiver les jeux, leur présentation, leurs notices et leurs réglages par défaut.',
  },
  {
    id: 'creation',
    title: 'Créer des jeux',
    text: 'Jeux de cartes, de plateau et de questions médias, banques BOUM !, paquets importés.',
  },
  {
    id: 'ambiance',
    title: 'Médias et ambiance',
    text: 'Médiathèque, fonds d’écran, musiques, bruitages et personnages illustrés.',
  },
  {
    id: 'systeme',
    title: 'Système',
    text: 'Journal des erreurs, clés d’IA, réglages généraux, sauvegardes et base de données.',
  },
] as const;

type AdminCategoryId = (typeof ADMIN_CATEGORIES)[number]['id'];

function isAdminCategory(value: string | null): value is AdminCategoryId {
  return ADMIN_CATEGORIES.some((c) => c.id === value);
}

export function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const category = isAdminCategory(sectionParam) ? sectionParam : null;
  const openCategory = (id: AdminCategoryId | null) => setSearchParams(id ? { section: id } : {});

  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api<Overview>('/api/admin/overview'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    api<{ authenticated: boolean }>('/api/admin/session')
      .then((r) => {
        setAuthenticated(r.authenticated);
        if (r.authenticated) void load();
      })
      .catch(() => setAuthenticated(false));
  }, [load]);

  useEffect(() => {
    if (!authenticated) return;
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [authenticated, load]);

  async function onLoggedIn() {
    setAuthenticated(true);
    await load();
  }

  async function logout() {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined);
    setAuthenticated(false);
    setOverview(null);
  }

  async function toggleGame(game: CatalogGame) {
    await api(`/api/admin/games/${encodeURIComponent(game.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !game.enabled }),
    }).catch((err: Error) => setError(err.message));
    void load();
  }

  async function closeRoom(code: string) {
    await api(`/api/admin/rooms/${encodeURIComponent(code)}`, { method: 'DELETE' }).catch((err: Error) =>
      setError(err.message),
    );
    void load();
  }

  async function purgeIdle() {
    const res = await api<{ removed: number }>('/api/admin/rooms/purge-idle', { method: 'POST' }).catch(
      (err: Error) => {
        setError(err.message);
        return null;
      },
    );
    if (res) setError(`${res.removed} salle(s) sans connexion supprimée(s).`);
    void load();
  }

  if (authenticated === null) {
    return (
      <main className="page center">
        <p>Vérification de la session…</p>
      </main>
    );
  }
  if (!authenticated || !overview) {
    return <Login onDone={onLoggedIn} />;
  }

  const stat = (key: string) => overview.stats[key] ?? 0;
  const current = ADMIN_CATEGORIES.find((c) => c.id === category);
  const enabledGames = overview.games.filter((g) => g.enabled).length;
  const customGames = overview.games.filter((g) => g.origin !== 'builtin').length;

  /** Ligne de résumé sous le titre de chaque rubrique du menu. */
  const summary: Record<AdminCategoryId, string> = {
    salles: `${overview.rooms.length} salle(s) ouverte(s)`,
    jeux: `${enabledGames} jeu(x) activé(s) sur ${overview.games.length}`,
    creation: `${customGames} jeu(x) créé(s) ou importé(s)`,
    ambiance: '',
    systeme: '',
  };

  const backToMenu = <BackButton onClick={() => openCategory(null)}>Menu de l’administration</BackButton>;

  return (
    <main className="page admin fade-in">
      <header className="admin-top">
        <h1>Administration</h1>
        <div>
          <span className="muted small">En service depuis {Math.floor(overview.uptimeSec / 60)} min</span>{' '}
          <button type="button" className="btn ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </header>

      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}

      {current ? (
        <>
          <div className="admin-category-head">
            {backToMenu}
            <h2>{current.title}</h2>
            <p className="muted">{current.text}</p>
          </div>

          {category === 'salles' && (
            <>
              <section className="card">
                <h2>Statistiques</h2>
                <div className="stats">
                  <div className="admin-stat">
                    <span className="big-number">{overview.rooms.length}</span>
                    <span>Salles ouvertes</span>
                  </div>
                  <div className="admin-stat">
                    <span className="big-number">{stat('rooms_created')}</span>
                    <span>Salles créées</span>
                  </div>
                  <div className="admin-stat">
                    <span className="big-number">{stat('games_started')}</span>
                    <span>Parties lancées</span>
                  </div>
                  <div className="admin-stat">
                    <span className="big-number">{stat('games_completed')}</span>
                    <span>Parties terminées</span>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="section-head">
                  <h2>Salles</h2>
                  <button type="button" className="btn ghost" onClick={purgeIdle}>
                    Supprimer les salles sans connexion
                  </button>
                </div>
                {overview.rooms.length === 0 ? (
                  <p className="muted">Aucune salle active.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Jeu</th>
                          <th>Statut</th>
                          <th>Joueurs</th>
                          <th>Appareils</th>
                          <th>Spectateurs</th>
                          <th>Hôte</th>
                          <th>Dernière activité</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {overview.rooms.map((r) => (
                          <tr key={r.code}>
                            <td>
                              <strong>{r.code}</strong>
                            </td>
                            <td className="nowrap">{r.gameName}</td>
                            <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                            <td>
                              {r.connected}/{r.players}
                            </td>
                            <td>{deviceSummary(r.devices ?? {})}</td>
                            <td>{r.observers ?? 0}</td>
                            <td>{r.hostConnected ? 'connecté' : 'absent'}</td>
                            <td>{new Date(r.lastActivity).toLocaleTimeString('fr-FR')}</td>
                            <td>
                              <button type="button" className="link-btn" onClick={() => closeRoom(r.code)}>
                                Fermer
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {category === 'jeux' && (
            <>
              <section className="card">
                <h2>Activation des jeux</h2>
                <ul className="games-admin">
                  {overview.games.map((g) => (
                    <li key={g.id}>
                      <span>
                        {g.icon} {g.name} <span className="muted small">v{g.version}</span>{' '}
                        {ORIGIN_LABEL[g.origin] && <span className="badge">{ORIGIN_LABEL[g.origin]}</span>}
                      </span>
                      <button
                        type="button"
                        className={g.enabled ? 'btn primary' : 'btn ghost'}
                        onClick={() => toggleGame(g)}
                      >
                        {g.enabled ? 'Activé' : 'Désactivé'}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card stack">
                <h2>Présentation des jeux intégrés et importés</h2>
                <p className="muted">
                  Nom, icône, description et durée estimée s’affichent partout dans l’application. Les règles et le
                  nombre de joueurs de chaque jeu ne se modifient pas ici ; seule la présentation change. Les jeux de
                  cartes, de plateau et de questions médias se modifient dans leur propre éditeur.
                </p>
                {overview.games
                  .filter((g) => g.origin === 'builtin' || g.origin === 'package')
                  .map((g) => (
                    <GameDetailsEditor key={g.id} game={g} onSaved={load} />
                  ))}
              </section>

              <section className="card stack">
                <h2>Réglages par défaut des parties</h2>
                <p className="muted">
                  Durées, nombre de manches et autres options proposées à l’hôte quand il crée une salle. Une salle déjà
                  ouverte garde ses réglages. Pour revenir au réglage du jeu, utilisez « Revenir aux réglages d’origine
                  ».
                </p>
                {overview.games
                  .filter((g) => viewsFor(g.id)?.Settings)
                  .map((g) => (
                    <GameSettingsEditor key={g.id} game={g} onSaved={load} />
                  ))}
              </section>

              <section className="card stack">
                <h2>Notices des jeux</h2>
                <p className="muted">Ce que voient les joueurs avant de jouer. La notice d’origine reste disponible.</p>
                {overview.games.map((g) => (
                  <NoticeEditor key={g.id} game={g} onSaved={load} />
                ))}
              </section>
            </>
          )}

          {category === 'creation' && (
            <>
              <section className="card stack">
                <h2>Jeux de cartes</h2>
                <CardGamesAdmin onChanged={load} />
              </section>

              <section className="card stack">
                <h2>Jeux de plateau</h2>
                <BoardGamesAdmin onChanged={load} />
              </section>

              <section className="card stack">
                <h2>Jeux de questions médias</h2>
                <MediaGamesAdmin onChanged={load} />
              </section>

              <section className="card stack">
                <h2>Banques BOUM !</h2>
                <p className="muted small">
                  Textes des manches : validez les entrées avant qu’elles ne sortent en partie. Seules les entrées
                  validées sont tirées.
                </p>
                <BoumBanksAdmin />
              </section>

              <section className="card stack">
                <h2>Paquets de jeux (.phgame)</h2>
                <PackagesAdmin onChanged={load} />
                <h3>Sources GitHub</h3>
                <PackageSourcesAdmin onChanged={load} />
              </section>
            </>
          )}

          {category === 'ambiance' && (
            <>
              <section className="card stack">
                <h2>Médiathèque</h2>
                <AssetLibrary
                  onChanged={() => {
                    void load();
                    setLibraryVersion((v) => v + 1);
                  }}
                />
              </section>

              <section className="card stack">
                <h2>Fonds d’écran</h2>
                <p className="muted small">
                  Une image de la médiathèque par écran. Le voile sombre reste par-dessus pour garder le texte lisible.
                </p>
                <ScreenBackgroundsAdmin libraryVersion={libraryVersion} />
              </section>

              <section className="card stack">
                <h2>Musiques et bruitages</h2>
                <p className="muted small">
                  Musique de fond pour les menus, l’accueil et la fin de partie, et un fichier pour chaque bruitage des
                  jeux.
                </p>
                <SoundSettingsAdmin libraryVersion={libraryVersion} />
              </section>

              <section className="card stack">
                <h2>Personnages illustrés (zip)</h2>
                <CharacterPacksAdmin onChanged={load} />
              </section>
            </>
          )}

          {category === 'systeme' && (
            <>
              <section className="card stack">
                <h2>Journal des erreurs</h2>
                <LogsAdmin />
              </section>

              <section className="card stack">
                <h2>Intelligence artificielle</h2>
                <AiSettingsAdmin />
              </section>

              <section className="card">
                <h2>Réglages généraux</h2>
                <SettingsForm settings={overview.settings} onSaved={load} />
              </section>

              <section className="card">
                <h2>Mode test</h2>
                <TestModeForm />
              </section>

              <section className="card stack">
                <h2>Sauvegarde et restauration</h2>
                <BackupPanel onChanged={load} />
                <h3>Base de données</h3>
                <DbBackups />
              </section>
            </>
          )}

          <div className="section-head">{backToMenu}</div>
        </>
      ) : (
        <>
          <nav aria-label="Rubriques de l’administration">
            <ul className="admin-menu">
              {ADMIN_CATEGORIES.map((c) => (
                <li key={c.id}>
                  <button type="button" className="card admin-menu-card" onClick={() => openCategory(c.id)}>
                    <span className="admin-menu-title">{c.title}</span>
                    <span className="muted small">{c.text}</span>
                    {summary[c.id] && <span className="admin-menu-count">{summary[c.id]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <BackButton to="/">Retour à l’accueil</BackButton>
        </>
      )}
    </main>
  );
}
