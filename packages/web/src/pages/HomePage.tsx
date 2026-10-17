import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CatalogGame } from '@partyhub/shared';
import { api } from '../api.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { DeviceChoice } from '../components/DeviceChoice.js';
import { NoticeDialog } from '../components/NoticeDialog.js';
import { CornerMenu, DrawerSection } from '../components/CornerMenu.js';
import { GameRow } from '../components/GameRow.js';
import { GameCard } from '../components/GameCard.js';
import { CatalogFilterPanel } from '../components/CatalogFilterPanel.js';
import { useMusicSlot } from '../sounds.js';
import { ProfileSwitcher } from '../profile/ProfileSwitcher.js';
import { CATEGORY_ORDER } from '../catalog/labels.js';
import {
  SORT_LABEL,
  applyFilters,
  countActiveFilters,
  parseFilters,
  resetFilters,
  writeFilters,
  type CatalogFilters,
  type SortKey,
} from '../catalog/filters.js';
import { readRecent } from '../catalog/recentGames.js';
import { launchGame } from '../catalog/launch.js';

const SORT_CHOICES = Object.keys(SORT_LABEL) as SortKey[];
const MAX_RECENT_SHOWN = 6;

function countLabel(n: number): string {
  if (n === 0) return 'Aucun jeu';
  return n === 1 ? '1 jeu' : `${n} jeux`;
}

/**
 * Catalogue de l'accueil. Les filtres, le tri, la recherche et l'affichage sont dans l'URL :
 * revenir d'une fiche de jeu retrouve la même liste.
 */
export function HomePage() {
  const navigate = useNavigate();
  useMusicSlot('accueil');
  const [params, setParams] = useSearchParams();
  const [games, setGames] = useState<CatalogGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<CatalogGame | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [recentIds] = useState<string[]>(() => readRecent());

  // Les filtres vivent dans l'écran (saisie instantanée) et sont reportés dans l'URL sans nouvelle entrée d'historique.
  // L'URL n'est relue qu'au montage : un retour depuis une fiche remonte la page.
  const [filters, setFilters] = useState<CatalogFilters>(() => parseFilters(params));
  const activeCount = countActiveFilters(filters);

  useEffect(() => {
    api<{ games: CatalogGame[] }>('/api/catalog')
      .then((r) => setGames(r.games))
      .catch((e: Error) => setError(e.message));
  }, []);

  const presentCategories = useMemo(() => {
    const present = new Set((games ?? []).map((g) => g.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [games]);

  const visible = useMemo(() => applyFilters(games ?? [], filters, recentIds), [games, filters, recentIds]);

  const recentGames = useMemo(
    () =>
      recentIds
        .map((id) => (games ?? []).find((g) => g.id === id))
        .filter((g): g is CatalogGame => g !== undefined)
        .slice(0, MAX_RECENT_SHOWN),
    [games, recentIds],
  );

  function commit(next: CatalogFilters) {
    setFilters(next);
    setParams(writeFilters(next, params), { replace: true });
  }

  function update(patch: Partial<CatalogFilters>) {
    commit({ ...filters, ...patch });
  }

  function clearFilters() {
    commit(resetFilters(filters));
  }

  async function launch(gameId: string, practice: boolean) {
    setBusy(`${practice ? 'try' : 'create'}:${gameId}`);
    setError(null);
    try {
      const code = await launchGame(gameId, practice);
      navigate(`/tv/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="page home fade-in">
      <CornerMenu open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={() => setMenuOpen(false)}>
        <DrawerSection title="Aller à">
          <nav className="corner-links" aria-label="Navigation">
            <Link to="/join" onClick={() => setMenuOpen(false)}>
              Rejoindre une salle
            </Link>
            <Link to="/profil" onClick={() => setMenuOpen(false)}>
              Mon profil
            </Link>
            <Link to="/admin" onClick={() => setMenuOpen(false)}>
              Administration
            </Link>
            <Link to="/test-appareils" onClick={() => setMenuOpen(false)}>
              Tester micro, caméra, image
            </Link>
            <Link to="/certificat" onClick={() => setMenuOpen(false)}>
              Installer le certificat HTTPS
            </Link>
          </nav>
        </DrawerSection>
        <DrawerSection title="Préférences">
          <DeviceChoice />
          <ThemeToggle />
        </DrawerSection>
      </CornerMenu>

      <div className="home-profile">
        <ProfileSwitcher />
      </div>

      <header className="hero">
        <h1 className="brand-title register-in" data-text="PartyHub">
          PartyHub
        </h1>
        <p>Choisissez un jeu, affichez la salle sur l’écran, et chacun rejoint depuis son téléphone.</p>
        <ul className="steps" aria-label="Le principe en trois temps">
          <li>
            <span aria-hidden="true">🖥️</span>
            Ouvrez la salle sur l’écran
          </li>
          <li>
            <span aria-hidden="true">📱</span>
            Rejoignez avec votre téléphone
          </li>
          <li>
            <span aria-hidden="true">🎉</span>
            Jouez ensemble
          </li>
        </ul>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {games === null && !error && <p className="muted">Chargement du catalogue…</p>}
      {games?.length === 0 && <p className="notice">Aucun jeu n’est disponible pour le moment.</p>}

      {games && games.length > 0 && (
        <section className="catalog" aria-labelledby="catalog-title">
          <div className="catalog-head">
            <h2 id="catalog-title" className="catalog-title">
              Jeux
            </h2>
            <p className="catalog-count" role="status">
              {countLabel(visible.length)}
            </p>
          </div>

          <div className="catalog-toolbar">
            <input
              className="catalog-search"
              type="search"
              aria-label="Rechercher un jeu"
              placeholder="Rechercher un jeu"
              maxLength={80}
              value={filters.query}
              onChange={(e) => update({ query: e.target.value })}
            />
            <div className="catalog-sort">
              <label htmlFor="catalog-sort">Trier par</label>
              <select
                id="catalog-sort"
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value as SortKey })}
              >
                {SORT_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="view-toggle" role="group" aria-label="Affichage">
              <button type="button" aria-pressed={filters.view === 'cards'} onClick={() => update({ view: 'cards' })}>
                Fiches
              </button>
              <button type="button" aria-pressed={filters.view === 'list'} onClick={() => update({ view: 'list' })}>
                Liste
              </button>
            </div>
            <button
              type="button"
              className="filters-toggle"
              aria-expanded={panelOpen}
              aria-controls="catalog-filters"
              onClick={() => setPanelOpen((open) => !open)}
            >
              Filtres{activeCount > 0 ? ` · ${activeCount}` : ''}
            </button>
          </div>

          <div className="catalog-body">
            <CatalogFilterPanel
              id="catalog-filters"
              hidden={!panelOpen}
              filters={filters}
              categories={presentCategories}
              recentCount={recentIds.length}
              activeCount={activeCount}
              onChange={update}
              onReset={clearFilters}
            />

            <div className="catalog-results">
              {activeCount === 0 && recentGames.length > 0 && (
                <section className="recent-strip" aria-labelledby="recent-title">
                  <h3 id="recent-title">Joués récemment</h3>
                  <ul>
                    {recentGames.map((g) => (
                      <li key={g.id}>
                        <GameCard game={g} compact />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {visible.length === 0 ? (
                <div className="catalog-empty">
                  <p>Aucun jeu ne correspond à ces critères.</p>
                  <button type="button" className="btn" onClick={clearFilters}>
                    Effacer les filtres
                  </button>
                </div>
              ) : filters.view === 'cards' ? (
                <ul className="game-grid" aria-label="Jeux disponibles">
                  {visible.map((g) => (
                    <li key={g.id}>
                      <GameCard game={g} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="game-list" aria-label="Jeux disponibles">
                  {visible.map((g) => (
                    <GameRow
                      key={g.id}
                      game={g}
                      detailsHref={`/jeux/${g.id}`}
                      open={openId === g.id}
                      creating={busy === `create:${g.id}`}
                      trying={busy === `try:${g.id}`}
                      busy={busy !== null}
                      onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                      onCreate={() => launch(g.id, false)}
                      onTry={() => launch(g.id, true)}
                      onNotice={() => setNotice(g)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {notice && <NoticeDialog game={notice} onClose={() => setNotice(null)} />}
    </main>
  );
}
