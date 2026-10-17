import { CharacterPackService } from './characters/packs.js';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
import { appliedCadence } from '@partyhub/shared';
import { gameRegistry } from '@partyhub/games';
import { resolveGame } from './games-registry.js';
import { CardGameService } from './cards/service.js';
import { BoumBankService } from './boum/service.js';
import { BoardGameService } from './boards/service.js';
import { PackageSourceService } from './sources/service.js';
import { AssetService } from './assets/service.js';
import { MediaQuizService } from './media/service.js';
import { PackageService } from './packages/service.js';
import { hashPassword } from './auth.js';
import { effectiveNotice } from './catalog.js';
import { gameDataFor } from './profiles/game-data.js';
import { ProfileService } from './profiles/service.js';
import type { AppConfig } from './config.js';
import { createApp } from './http/app.js';
import { Store } from './db/store.js';
import type { Logger } from './logger.js';
import type { RotatingFile } from './logs/rotating-file.js';
import { RealtimeHub, type SocketData } from './realtime/hub.js';
import { RoomManager } from './rooms/manager.js';
import { AiRuntime } from './ai/runtime.js';
import { IMAGES_DEFAULTS, buildImageProviders } from './images/config.js';
import { createGameImages } from './images/game-images.js';
import { ImageLibrary } from './images/library.js';
import { GamePhotoStore } from './game-photos/store.js';
import { DbBackupScheduler } from './db/backup.js';
import { compileTrustProxy } from './trust-proxy.js';
import type { JoinThrottleOptions } from './realtime/join-throttle.js';

export interface PartyServer {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  manager: RoomManager;
  store: Store;
  profiles: ProfileService;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export interface ServerOptions {
  config: AppConfig;
  logger: Logger;
  /** Journal fichier (consultable depuis l’administration). Absent = sortie standard seulement. */
  journal?: RotatingFile;
  /** Période du nettoyage des salles (0 = désactivé, utile aux tests). */
  sweepEveryMs?: number;
  /** Réglages du ralentissement des codes inconnus (valeurs par défaut sinon). */
  joinThrottle?: Partial<JoinThrottleOptions>;
}

/**
 * Mot de passe administrateur :
 * - ADMIN_PASSWORD fourni : il fait toujours foi au démarrage ;
 * - sinon, généré une seule fois et écrit dans DATA_DIR/admin-password.txt.
 */
async function ensureAdminPassword(store: Store, config: AppConfig, logger: Logger): Promise<void> {
  if (config.adminPassword) {
    store.setKv('admin_password_hash', await hashPassword(config.adminPassword));
    return;
  }
  if (store.getKv('admin_password_hash')) return;

  const generated = randomBytes(12).toString('base64url');
  store.setKv('admin_password_hash', await hashPassword(generated));
  const file = path.join(config.dataDir, 'admin-password.txt');
  writeFileSync(file, `${generated}\n`, { mode: 0o600 });
  logger.warn(
    { event: 'admin.password-generated', file },
    'Mot de passe administrateur généré : lisez ce fichier, puis supprimez-le',
  );
}

export async function createServer(opts: ServerOptions): Promise<PartyServer> {
  const { config, logger } = opts;
  // Avant toute migration d’une base existante, une copie de sécurité est créée dans DATA_DIR/migrations.
  const store = new Store(config.dbFile, { backupDir: path.join(config.dataDir, 'migrations') });
  const migration = store.migration;
  if (migration.to !== migration.from) {
    logger.info(
      { event: 'db.migrated', from: migration.from, to: migration.to, backup: migration.backup },
      'Schéma de la base mis à jour',
    );
  }
  // Installation neuve (aucun mot de passe administrateur encore créé) : jeux intégrés désactivés si configuré.
  // Une installation existante garde ses réglages, même si elle a été mise à jour.
  // Un outil non listé (plateau de test) reste actif : le bouton de l’accueil doit toujours fonctionner.
  if (config.builtinGames === false && store.getKv('admin_password_hash') === undefined) {
    const games = gameRegistry.filter((game) => game.manifest.listed !== false);
    for (const game of games) store.setGameEnabled(game.manifest.id, false);
    logger.info(
      { event: 'db.fresh-install', count: games.length },
      'Installation neuve : jeux intégrés désactivés (BUILTIN_GAMES=on pour les activer)',
    );
  }
  await ensureAdminPassword(store, config, logger);

  const profiles = new ProfileService(store);
  const cardGames = new CardGameService(store);
  const boumBank = new BoumBankService(store);
  const boardGames = new BoardGameService(store);
  const assets = new AssetService(store, config.dataDir, config.assetLimits);
  const mediaGames = new MediaQuizService(store, assets);
  const packages = new PackageService(store, config.dataDir);
  const packageSources = new PackageSourceService(store, packages, { token: config.githubToken });
  const characterPacks = new CharacterPackService(store.db);
  const hub = new RealtimeHub(compileTrustProxy(config.trustProxy ?? 'loopback'), opts.joinThrottle);
  hub.setCadence(() => appliedCadence(store.getTestMode()));
  // Les fournisseurs viennent de l’environnement et de l’administration (clés saisies dans l’interface).
  const aiRuntime = new AiRuntime(store, config.ai, config.dataDir, logger);
  // Images générées (portraits, fonds) : une bibliothèque partagée par les jeux, alimentée par les fournisseurs
  // configurés (Cloudflare, ModelScope). Sans fournisseur, les jeux gardent leur rendu de secours.
  const imageLibrary = new ImageLibrary(store);
  // Captures de la première partie de chaque jeu (fiche du jeu), rangées dans le dossier de données.
  const gamePhotos = new GamePhotoStore(config.dataDir);
  const imageConfig = config.images ?? { providers: [], ...IMAGES_DEFAULTS };
  const gameImages = createGameImages({
    providers: buildImageProviders(imageConfig),
    library: imageLibrary,
    maxPerDay: imageConfig.maxPerDay,
    timeoutMs: imageConfig.timeoutMs,
    logger,
  });
  const manager = new RoomManager(
    {
      now: () => Date.now(),
      random: () => Math.random(),
      logger,
      ai: aiRuntime,
      images: gameImages,
      gameData: gameDataFor(store),
      maxPlayers: () => store.getSettings().maxPlayers,
      graceMs: () => store.getSettings().graceSeconds * 1000,
      notice: (gameId) => {
        const module = resolveGame(gameId);
        return effectiveNotice(store, gameId, module?.manifest.notice ?? { goal: '', steps: [], tips: [] });
      },
    },
    {
      onChange: (room) => hub.onRoomChanged(room),
      onClosed: (room, reason) => hub.onRoomClosed(room, reason),
      onGameStarted: (room) => {
        store.incrementStat('games_started');
        store.incrementStat(`games_started:${room.module.manifest.id}`);
      },
      onGameEnded: (room) => {
        const gameId = room.module.manifest.id;
        store.incrementStat('games_completed');
        store.incrementStat(`games_completed:${gameId}`);
        // Les parties d’essai ne comptent pas dans les statistiques des profils.
        if (room.practice) return;
        for (const entry of room.finalScores()) {
          const player = room.players.get(entry.playerId);
          if (player?.profileId && !player.bot) {
            profiles.recordResult(player.profileId, gameId, entry.points, entry.rank === 1);
          }
        }
      },
    },
    200,
    () => store.getSettings().roomCodeLength,
  );

  const dbBackups = config.backup ? new DbBackupScheduler(store, config.backup, logger) : undefined;
  const app = createApp({
    config,
    logger,
    ai: aiRuntime,
    imageLibrary,
    gamePhotos,
    journal: opts.journal,
    store,
    manager,
    hub,
    profiles,
    cardGames,
    boumBank,
    boardGames,
    packageSources,
    assets,
    mediaGames,
    packages,
    characterPacks,
    dbBackups,
  });
  dbBackups?.start();
  const httpServer = createHttpServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  hub.attach(io, manager, logger, profiles);

  // Sources à mise à jour automatique : vérification une fois par jour, sans bloquer le démarrage.
  const sourcesTimer = packageSources.schedule();

  const sweepEvery = opts.sweepEveryMs ?? 60_000;
  let sweeper: NodeJS.Timeout | undefined;
  if (sweepEvery > 0) {
    sweeper = setInterval(() => {
      const s = store.getSettings();
      const removed = manager.sweep({
        inactivityMs: s.inactivityMinutes * 60_000,
        maxAgeMs: s.maxRoomAgeMinutes * 60_000,
      });
      if (removed > 0) logger.info({ event: 'room.purged', removed }, 'Salles inactives nettoyées');
    }, sweepEvery);
    sweeper.unref();
  }

  return {
    httpServer,
    io,
    manager,
    store,
    profiles,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          const address = httpServer.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    async close() {
      if (sweeper) clearInterval(sweeper);
      dbBackups?.stop();
      clearInterval(sourcesTimer);
      manager.destroyAll();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      store.close();
    },
  };
}
