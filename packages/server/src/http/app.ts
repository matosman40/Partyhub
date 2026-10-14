import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  createRoomSchema,
  loginSchema,
  noticeSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  registerSchema,
  roomCodeSchema,
} from '@partyhub/shared';
import { resolveGame } from '../games-registry.js';
import type { BoardGameService } from '../boards/service.js';
import type { PackageSourceService } from '../sources/service.js';
import type { CardGameService } from '../cards/service.js';
import type { AssetService } from '../assets/service.js';
import type { PackageService } from '../packages/service.js';
import { copyPackageToEditable } from '../packages/copy.js';
import type { MediaQuizService } from '../media/service.js';
import { AdminSessions, LoginLimiter, readCookie, verifyPassword } from '../auth.js';
import { catalog, gameInfo, originOf } from '../catalog.js';
import { withOverrides } from '../game-details.js';
import { buildBackup, restoreBackup } from '../backup.js';
import { gameDetailsSchema } from '@partyhub/shared';
import type { AppConfig } from '../config.js';
import { adminSettingsSchema, type Store } from '../db/store.js';
import type { Logger } from '../logger.js';
import type { RoomManager } from '../rooms/manager.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { ProfileError, type ProfileService } from '../profiles/service.js';
import { type DbBackupScheduler, listDbBackups } from '../db/backup.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  store: Store;
  manager: RoomManager;
  hub: RealtimeHub;
  profiles: ProfileService;
  cardGames: CardGameService;
  /** Jeux de plateau créés dans l'administration. */
  boardGames: BoardGameService;
  /** Sources GitHub des paquets .phgame. */
  packageSources: PackageSourceService;
  assets: AssetService;
  mediaGames: MediaQuizService;
  /** Paquets .phgame installés (jeux déclaratifs). */
  packages: PackageService;
  /** Sauvegardes automatiques de la base. Absent = fonction non configurée. */
  dbBackups?: DbBackupScheduler;
}

const ADMIN_COOKIE = 'ph_admin';
const ADMIN_COOKIE_PATH = '/api/admin';
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

export function createApp(deps: AppDeps): express.Express {
  const { config, logger, store, manager, profiles, cardGames, boardGames, packageSources, assets, mediaGames, dbBackups, packages } = deps;
  const app = express();
  // Sessions d'administration stockées en base : elles survivent à un redémarrage.
  const sessions = new AdminSessions(store.db);
  const limiter = new LoginLimiter();
  const registerLimiter = new LoginLimiter(40);
  const profileLimiter = new LoginLimiter(10);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? 'loopback');
  // Les images de profil tiennent dans le corps JSON (60 Ko maximum après encodage).
  // La sauvegarde complète est lue plus bas, avec sa propre limite.
  const jsonBody = express.json({ limit: '80kb' });
  // Ces deux routes lisent elles-mêmes leur corps : le JSON global ne doit pas y toucher.
  app.use((req, res, next) => {
    const selfParsed = req.path === '/api/admin/backup/import' || (req.method === 'POST' && req.path === '/api/admin/assets');
    return selfParsed ? next() : jsonBody(req, res, next);
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // YouTube est autorisé uniquement pour les extraits des jeux de questions (API du lecteur,
    // iframe du lecteur, oEmbed de l'administration). Tout le reste reste limité à ce site.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
        "media-src 'self'; connect-src 'self' ws: wss: https://www.youtube.com; object-src 'none'; " +
        "base-uri 'self'; frame-ancestors 'self'",
    );
    next();
  });

  // --- API publique ---------------------------------------------------------

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get('/catalog', (_req, res) => {
    res.json({ games: catalog(store, false) });
  });

  api.post('/rooms', (req, res) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Jeu invalide.' });
      return;
    }
    const original = resolveGame(parsed.data.gameId);
    if (!original || !store.isGameEnabled(original.manifest.id)) {
      res.status(404).json({ error: "Ce jeu n'est pas disponible." });
      return;
    }
    const module = withOverrides(original, store);
    const practice = parsed.data.practice === true;
    const room = manager.create(module, { practice });
    if (!room) {
      res.status(503).json({ error: 'Trop de salles ouvertes. Réessayez dans quelques minutes.' });
      return;
    }
    if (practice) {
      // Mode test : des robots remplissent la salle, l'hôte peut jouer aussi depuis l'écran.
      const bots = Math.min(3, room.effectiveMaxPlayers - 1);
      for (let i = 0; i < bots; i++) room.addBot();
      store.incrementStat('practice_rooms');
    }
    store.incrementStat('rooms_created');
    res.status(201).json({ code: room.code, hostToken: room.hostToken, game: gameInfo(module) });
  });

  /** Vérifie qu'un code existe avant d'afficher le formulaire d'entrée. */
  api.get('/rooms/:code', (req, res) => {
    const parsed = roomCodeSchema.safeParse(req.params.code);
    const room = parsed.success ? manager.getByCode(parsed.data) : undefined;
    res.json({
      exists: Boolean(room),
      status: room?.status ?? null,
      gameName: room?.module.manifest.name ?? null,
    });
  });

  // Ressources graphiques d'un paquet installé et activé. Lecture publique : rien de privé n'est exposé.
  app.get(/^\/api\/packages\/([a-z0-9-]+)\/assets\/(.+)$/, (req, res) => {
    const id = String(req.params[0] ?? '');
    const asset = packages.asset(id, `assets/${String(req.params[1] ?? '')}`);
    if (!asset) {
      res.status(404).json({ error: 'Ressource introuvable.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(asset.contentType).send(Buffer.from(asset.bytes));
  });

  app.use('/api', api);

  // --- Profils joueurs ------------------------------------------------------

  const bearer = (req: Request): string | undefined => {
    const header = req.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice(7) : undefined;
  };

  /** Route réservée aux profils connectés : renseigne req.profileId. */
  const withProfile = (req: Request, res: Response, next: NextFunction) => {
    const profileId = profiles.authenticate(bearer(req));
    if (!profileId) {
      res.status(401).json({ error: 'Connexion au profil requise.' });
      return;
    }
    (req as Request & { profileId: string }).profileId = profileId;
    next();
  };
  const profileOf = (req: Request) => (req as Request & { profileId: string }).profileId;

  /** Réponse d'erreur métier, ou erreur interne. */
  const fail = (res: Response, err: unknown) => {
    if (err instanceof ProfileError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  };

  const profileRoutes = express.Router();

  profileRoutes.post('/register', async (req, res) => {
    const ip = req.ip ?? 'inconnue';
    if (!registerLimiter.allow(ip)) {
      res.status(429).json({ error: 'Trop de créations de profil. Réessayez dans quelques minutes.' });
      return;
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' });
      return;
    }
    try {
      const result = await profiles.register(parsed.data);
      registerLimiter.hit(ip);
      res.status(201).json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  profileRoutes.post('/login', async (req, res) => {
    const ip = req.ip ?? 'inconnue';
    if (!profileLimiter.allow(ip)) {
      res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      return;
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
      return;
    }
    try {
      const result = await profiles.login(parsed.data.username, parsed.data.password);
      profileLimiter.reset(ip);
      res.json(result);
    } catch (err) {
      profileLimiter.fail(ip);
      fail(res, err);
    }
  });

  profileRoutes.post('/logout', (req, res) => {
    const token = bearer(req);
    if (token) profiles.logout(token);
    res.json({ ok: true });
  });

  profileRoutes.get('/me', withProfile, (req, res) => {
    res.json({ profile: profiles.view(profileOf(req)) });
  });

  profileRoutes.put('/me', withProfile, (req, res) => {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' });
      return;
    }
    const { displayName, avatarHue, avatarEmoji, avatarImage, avatarShared } = parsed.data;
    const profileId = profileOf(req);
    const profile = profiles.update(profileId, {
      displayName,
      avatarHue,
      avatarEmoji,
      avatarImage,
      avatarShared,
    });
    // Une salle en cours montre tout de suite le nouvel état (une photo retirée disparaît aussitôt).
    const inRooms = profiles.playerProfile(profileId);
    if (inRooms) manager.refreshAvatar(profileId, inRooms.avatar);
    res.json({ profile });
  });

  profileRoutes.put('/me/password', withProfile, async (req, res) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' });
      return;
    }
    try {
      await profiles.changePassword(profileOf(req), parsed.data.current, parsed.data.next);
      // Les autres appareils sont déconnectés ; celui-ci reçoit une nouvelle session.
      res.json({ token: profiles.renewSession(profileOf(req)) });
    } catch (err) {
      fail(res, err);
    }
  });

  profileRoutes.delete('/me', withProfile, (req, res) => {
    profiles.delete(profileOf(req));
    res.json({ ok: true });
  });

  api.use('/profiles', profileRoutes);

  /** Image de profil : servie à part pour ne pas alourdir les vues de salle. */
  /** Fichiers de la médiathèque (audio, vidéo, image). Identifiants aléatoires : contenu immuable. */
  api.get('/assets/:id', (req, res) => {
    const asset = assets.get(req.params.id ?? '');
    if (!asset) {
      res.status(404).json({ error: 'Fichier introuvable.' });
      return;
    }
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(assets.filePath(asset.id), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Fichier introuvable.' });
    });
  });

  api.get('/avatars/:id', (req, res) => {
    const image = profiles.avatarImage(req.params.id ?? '');
    if (!image) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(image.mime).send(image.data);
  });

  // --- Administration (authentification obligatoire) -------------------------

  const admin = express.Router();

  admin.get('/session', (req, res) => {
    res.json({ authenticated: sessions.valid(readCookie(req.headers.cookie, ADMIN_COOKIE)) });
  });

  admin.post('/login', async (req, res) => {
    const ip = req.ip ?? 'inconnue';
    if (!limiter.allow(ip)) {
      res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const stored = store.getKv('admin_password_hash') ?? '';
    const valid = password.length > 0 && (await verifyPassword(password, stored));
    if (!valid) {
      limiter.fail(ip);
      logger.warn({ ip }, 'Tentative de connexion administrateur refusée');
      res.status(401).json({ error: 'Mot de passe incorrect.' });
      return;
    }
    limiter.reset(ip);
    res.cookie(ADMIN_COOKIE, sessions.create(), {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      maxAge: ADMIN_SESSION_MS,
      path: ADMIN_COOKIE_PATH,
    });
    res.json({ ok: true });
  });

  admin.post('/logout', (req, res) => {
    sessions.revoke(readCookie(req.headers.cookie, ADMIN_COOKIE));
    res.clearCookie(ADMIN_COOKIE, { path: ADMIN_COOKIE_PATH });
    res.json({ ok: true });
  });

  admin.use((req: Request, res: Response, next: NextFunction) => {
    if (!sessions.valid(readCookie(req.headers.cookie, ADMIN_COOKIE))) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    next();
  });

  admin.get('/overview', (_req, res) => {
    res.json({
      settings: store.getSettings(),
      games: catalog(store, true),
      rooms: manager.all().map((r) => r.summary()),
      stats: store.stats(),
      profiles: profiles.count(),
      uptimeSec: Math.round(process.uptime()),
    });
  });

  admin.put('/notices/:id', (req, res) => {
    const id = req.params.id ?? '';
    if (!resolveGame(id)) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    const parsed = noticeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Notice invalide.' });
      return;
    }
    store.setNoticeOverride(id, JSON.stringify(parsed.data));
    res.json({ ok: true });
  });

  /** Nom, icône et description d'un jeu intégré : surcharge de l'administration. */
  admin.put('/game-details/:id', (req, res) => {
    const id = req.params.id ?? '';
    const game = resolveGame(id);
    if (!game || originOf(id) !== 'builtin') {
      res.status(404).json({ error: 'Seuls les jeux intégrés se modifient ici. Les autres se modifient dans leur éditeur.' });
      return;
    }
    const parsed = gameDetailsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Informations invalides.' });
      return;
    }
    store.setDetailsOverride(id, JSON.stringify(parsed.data));
    res.json({ ok: true });
  });

  /** Retour au nom, à l'icône et à la description d'origine. */
  admin.delete('/game-details/:id', (req, res) => {
    store.clearDetailsOverride(req.params.id ?? '');
    res.json({ ok: true });
  });

  /** Retour à la notice d'origine, définie dans le code du jeu. */
  admin.delete('/notices/:id', (req, res) => {
    store.clearNoticeOverride(req.params.id ?? '');
    res.json({ ok: true });
  });

  /** Jeux de cartes personnalisés : liste, création, modification et suppression. */
  admin.get('/card-games', (_req, res) => {
    res.json({ games: cardGames.list() });
  });

  admin.post('/card-games', (req, res) => {
    const result = cardGames.save(null, req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  admin.put('/card-games/:id', (req, res) => {
    const id = req.params.id ?? '';
    const result = cardGames.save(id, req.body);
    if (!result.ok) {
      res.status(result.error === 'Jeu inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  });

  admin.delete('/card-games/:id', (req, res) => {
    const id = req.params.id ?? '';
    if (!cardGames.remove(id)) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    // Les salles qui jouent ce jeu sont fermées : aucune partie ne reste bloquée.
    const closed = manager.closeWhere((r) => r.module.manifest.id === id, 'admin');
    res.json({ ok: true, closedRooms: closed });
  });

  admin.post('/card-games/:id/duplicate', (req, res) => {
    const result = cardGames.duplicate(req.params.id ?? '');
    if (!result.ok) {
      res.status(result.error === 'Jeu inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  /** Jeux de plateau personnalisés : liste, création, modification, copie et suppression. */
  admin.get('/board-games', (_req, res) => {
    res.json({ games: boardGames.list() });
  });

  admin.post('/board-games', (req, res) => {
    const result = boardGames.save(null, req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  admin.put('/board-games/:id', (req, res) => {
    const id = req.params.id ?? '';
    const result = boardGames.save(id, req.body);
    if (!result.ok) {
      res.status(result.error === 'Jeu inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, id: result.id });
  });

  admin.delete('/board-games/:id', (req, res) => {
    const id = req.params.id ?? '';
    if (!boardGames.remove(id)) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    // Les salles qui jouent ce plateau sont fermées : aucune partie ne reste bloquée.
    const closed = manager.closeWhere((r) => r.module.manifest.id === id, 'admin');
    res.json({ ok: true, closedRooms: closed });
  });

  admin.post('/board-games/:id/duplicate', (req, res) => {
    const result = boardGames.duplicate(req.params.id ?? '');
    if (!result.ok) {
      res.status(result.error === 'Jeu inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  /** Sources GitHub : ajout (avec première vérification), réglages, vérification et suppression. */
  admin.get('/package-sources', (_req, res) => {
    res.json({ sources: packageSources.list(), tokenConfigured: packageSources.tokenConfigured });
  });

  admin.post('/package-sources', async (req, res) => {
    const added = packageSources.add(req.body);
    if (!added.ok) {
      res.status(400).json({ error: added.error });
      return;
    }
    const outcome = await packageSources.check(added.id);
    res.status(201).json({ ok: true, id: added.id, outcome });
  });

  admin.put('/package-sources/:id', (req, res) => {
    const result = packageSources.update(req.params.id ?? '', req.body);
    if (!result.ok) {
      res.status(result.notFound ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  admin.post('/package-sources/check-all', async (_req, res) => {
    const results = await packageSources.checkAll(false);
    res.json({ results });
  });

  admin.post('/package-sources/:id/check', async (req, res) => {
    const id = req.params.id ?? '';
    const outcome = await packageSources.check(id);
    if (!outcome.ok && outcome.error === 'Source inconnue.') {
      res.status(404).json({ error: outcome.error });
      return;
    }
    res.json({ outcome });
  });

  admin.delete('/package-sources/:id', (req, res) => {
    if (!packageSources.remove(req.params.id ?? '')) {
      res.status(404).json({ error: 'Source inconnue.' });
      return;
    }
    res.json({ ok: true });
  });

  /** Paquets .phgame : liste, envoi du fichier brut, activation et suppression. */
  admin.get('/packages', (_req, res) => {
    res.json({ packages: packages.list() });
  });

  admin.post('/packages', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'Aucun fichier reçu.' });
      return;
    }
    const result = packages.install(body);
    if (!result.ok) {
      res.status(400).json({ error: result.error, issues: result.issues ?? [] });
      return;
    }
    res.status(result.unchanged ? 200 : 201).json(result);
  });

  admin.post('/packages/:id/status', (req, res) => {
    const id = req.params.id ?? '';
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Valeur attendue : enabled (vrai ou faux).' });
      return;
    }
    const record = packages.get(id);
    if (!record) {
      res.status(404).json({ error: 'Paquet inconnu.' });
      return;
    }
    packages.setEnabled(id, enabled);
    // Désactiver un paquet ferme les salles qui le jouent : aucune partie ne reste bloquée.
    const closed = enabled ? 0 : manager.closeWhere((r) => r.module.manifest.id === record.gameId, 'admin');
    res.json({ ok: true, closedRooms: closed });
  });

  admin.delete('/packages/:id', (req, res) => {
    const id = req.params.id ?? '';
    const record = packages.get(id);
    if (!record || !packages.remove(id)) {
      res.status(404).json({ error: 'Paquet inconnu.' });
      return;
    }
    const closed = manager.closeWhere((r) => r.module.manifest.id === record.gameId, 'admin');
    res.json({ ok: true, closedRooms: closed });
  });

  /** Versions d'un paquet (active et conservées) et retour arrière vers une version conservée. */
  admin.get('/packages/:id/versions', (req, res) => {
    const versions = packages.versions(req.params.id ?? '');
    if (!versions) {
      res.status(404).json({ error: 'Paquet inconnu.' });
      return;
    }
    res.json({ versions });
  });

  admin.post('/packages/:id/versions/:version/activate', (req, res) => {
    const result = packages.activate(req.params.id ?? '', req.params.version ?? '');
    if (!result.ok) {
      res.status(result.error === 'Paquet inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, version: result.version });
  });

  /** Copie modifiable d'un paquet actif : le paquet reste installé et inchangé. */
  admin.post('/packages/:id/copy', (req, res) => {
    const result = copyPackageToEditable(req.params.id ?? '', { packages, cardGames, boardGames, mediaGames });
    if (!result.ok) {
      res.status(result.error === 'Paquet inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  });

  /** Jeux de questions médias (extraits de vidéos YouTube ou de la médiathèque). */
  admin.get('/media-games', (_req, res) => {
    res.json({ games: mediaGames.list() });
  });

  admin.post('/media-games', (req, res) => {
    const result = mediaGames.save(null, req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  admin.put('/media-games/:id', (req, res) => {
    const id = req.params.id ?? '';
    const result = mediaGames.save(id, req.body);
    if (!result.ok) {
      res.status(result.error === 'Jeu inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    // Les salles en cours gardent la version avec laquelle elles ont démarré ; les nouvelles
    // parties prennent la modification.
    res.json({ ok: true, id: result.id });
  });

  admin.delete('/media-games/:id', (req, res) => {
    const id = req.params.id ?? '';
    if (!mediaGames.remove(id)) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    const closed = manager.closeWhere((r) => r.module.manifest.id === id, 'admin');
    res.json({ ok: true, closedRooms: closed });
  });

  admin.post('/media-games/:id/duplicate', (req, res) => {
    const result = mediaGames.duplicate(req.params.id ?? '');
    if (!result.ok) {
      res.status(result.error === 'Jeu inconnu.' ? 404 : 400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  admin.get('/media-games/:id/export', (req, res) => {
    const exported = mediaGames.exportOf(req.params.id ?? '');
    if (!exported) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    const slug = exported.definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jeu';
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.partyhub.json"`);
    res.json(exported);
  });

  /** Import d'un fichier exporté. Refusé tant qu'un fichier de la médiathèque manque. */
  admin.post('/media-games/import', (req, res) => {
    const parsed = mediaGames.parseImport(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const missing = mediaGames.referenceErrors(parsed.definition);
    if (missing.length > 0) {
      res.status(400).json({
        error: `Import impossible : ${missing.length} fichier(s) manquent dans la médiathèque. Importez-les d’abord, puis réessayez. ${missing[0]}`,
      });
      return;
    }
    const result = mediaGames.save(null, parsed.definition);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  admin.get('/card-games/:id/export', (req, res) => {
    const exported = cardGames.exportOf(req.params.id ?? '');
    if (!exported) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    const slug = exported.definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jeu';
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.partyhub.json"`);
    res.json(exported);
  });

  admin.post('/card-games/import', (req, res) => {
    const parsed = cardGames.parseImport(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const result = cardGames.save(null, parsed.definition);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, id: result.id });
  });

  /** Sauvegardes automatiques de la base : état, liste, et sauvegarde immédiate. */
  admin.get('/db-backups', (_req, res) => {
    if (!dbBackups) {
      res.json({ enabled: false, everyHours: 0, keep: 0, backups: [] });
      return;
    }
    const { everyMs, keep, dir } = dbBackups.settings;
    res.json({
      enabled: dbBackups.enabled,
      everyHours: Math.round(everyMs / (60 * 60 * 1000)),
      keep,
      backups: listDbBackups(dir),
    });
  });

  admin.post('/db-backups', (_req, res) => {
    if (!dbBackups) {
      res.status(409).json({ error: 'Les sauvegardes de la base ne sont pas configurées.' });
      return;
    }
    const result = dbBackups.runNow();
    if (!result.ok) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, name: result.name });
  });

  /** Sauvegarde complète : jeux personnalisés, textes et notices des jeux intégrés. */
  admin.get('/backup', (_req, res) => {
    const backup = buildBackup(store, cardGames, mediaGames, boardGames);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="partyhub-sauvegarde-${stamp}.json"`);
    res.json(backup);
  });

  admin.post('/backup/import', (req, res) => {
    const result = restoreBackup(req.body, store, cardGames, mediaGames, boardGames);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, summary: result.summary });
  });

  /** Médiathèque : fichiers audio, vidéo et images réutilisables par les jeux. */
  /** Jeux qui utilisent une ressource de la médiathèque : questions médias et cartes (dos, police). */
  const usersOf = (assetId: string): string[] => [...mediaGames.usersOfAsset(assetId), ...cardGames.usersOfAsset(assetId)];

  admin.get('/assets', (_req, res) => {
    res.json({
      assets: assets.list().map((a) => ({ ...a, usedBy: usersOf(a.id) })),
      limits: assets.limitsByKind,
    });
  });

  /**
   * Envoi d'un fichier de médiathèque, lu en flux : rien n'est gardé en mémoire.
   * En cas de refus, la réponse part d'abord, puis la connexion est coupée pour ne pas
   * lire la suite de l'envoi.
   */
  admin.post('/assets', (req, res) => {
    const rawName = typeof req.headers['x-file-name'] === 'string' ? req.headers['x-file-name'] : 'fichier';
    let name = rawName;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      // Nom mal encodé : on garde la version brute.
    }
    const declared = Number(req.headers['content-length']);
    assets
      .receive(req, name, Number.isFinite(declared) ? declared : undefined)
      .then((result) => {
        if (!result.ok) {
          res.status(result.status).set('Connection', 'close').json({ error: result.error });
          res.once('finish', () => req.destroy());
          return;
        }
        res.status(201).json({ ok: true, asset: result.asset });
      })
      .catch(() => {
        if (!res.headersSent) res.status(500).json({ error: 'Enregistrement impossible.' });
      });
  });

  admin.delete('/assets/:id', (req, res) => {
    const id = req.params.id ?? '';
    if (!assets.get(id)) {
      res.status(404).json({ error: 'Fichier introuvable.' });
      return;
    }
    const users = usersOf(id);
    if (users.length > 0) {
      res.status(409).json({
        error: `Ce fichier sert encore dans : ${users.join(', ')}. Retirez-le de ces jeux avant de le supprimer.`,
      });
      return;
    }
    assets.remove(id);
    res.json({ ok: true });
  });

  admin.put('/games/:id', (req, res) => {
    const id = req.params.id;
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Valeur « enabled » attendue (true ou false).' });
      return;
    }
    if (!resolveGame(id)) {
      res.status(404).json({ error: 'Jeu inconnu.' });
      return;
    }
    store.setGameEnabled(id, enabled);
    // Désactiver un jeu ferme les salles qui le jouent : aucune partie ne reste bloquée.
    const closed = enabled ? 0 : manager.closeWhere((r) => r.module.manifest.id === id, 'admin');
    res.json({ ok: true, closedRooms: closed });
  });

  admin.put('/settings', (req, res) => {
    const parsed = adminSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Réglages invalides.' });
      return;
    }
    store.saveSettings(parsed.data);
    res.json({ settings: parsed.data });
  });

  admin.post('/rooms/purge-idle', (_req, res) => {
    res.json({ removed: manager.purgeIdle() });
  });

  admin.delete('/rooms/:code', (req, res) => {
    const room = manager.getByCode(req.params.code);
    if (!room) {
      res.status(404).json({ error: 'Salle introuvable.' });
      return;
    }
    manager.close(room, 'admin');
    res.json({ ok: true });
  });

  // Définitions de jeux (jusqu'à 60 extraits) : 512 Ko. Sauvegarde complète : 20 Mo.
  app.use(
    '/api/admin',
    (req, res, next) => {
      // L'envoi de médiathèque est lu en flux par sa route : pas de lecture JSON ici.
      // Les paquets sont lus bruts par leur propre route (archive ZIP, pas de JSON).
      if (req.method === 'POST' && (req.path === '/assets' || req.path === '/packages')) return next();
      return express.json({ limit: req.path === '/backup/import' ? '20mb' : '512kb' })(req, res, next);
    },
    admin,
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route introuvable.' });
  });

  // --- Interface web (fichiers statiques + repli sur index.html) -------------

  const indexFile = path.join(config.staticDir, 'index.html');
  if (existsSync(indexFile)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(indexFile);
    });
  } else {
    logger.warn({ staticDir: config.staticDir }, 'Interface web absente : lancer npm run build');
  }

  // --- Erreurs ---------------------------------------------------------------

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    if (status >= 500) logger.error({ err }, 'Erreur HTTP');
    const message =
      status === 400 ? 'Requête invalide.' : status === 413 ? 'Requête trop volumineuse.' : 'Erreur interne.';
    res.status(status).json({ error: message });
  });

  return app;
}
