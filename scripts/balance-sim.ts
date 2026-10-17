/**
 * Équilibrage par simulation : chaque jeu intégré joue des parties entièrement par des robots, sans réseau
 * ni horloge réelle. On mesure si la partie finit, combien d’actions elle demande, et si une place gagne
 * plus souvent que les autres (avantage de place) ou jamais.
 *
 * Limites, à garder en tête en lisant les résultats :
 * - les robots jouent tous de la même façon, sans délai humain (le salon, lui, attend 0,7 à 2 s) ;
 * - une place qui gagne plus ou moins qu’attendu peut venir de la stratégie du robot, pas du jeu ;
 * - les travaux asynchrones (IA) s’exécutent sans clé : le jeu prend alors son repli intégré, comme un salon
 *   sans IA configurée ;
 * - un jeu sans robot (`suggest` absent) n’a pas de simulation et est signalé à part.
 *
 * Usage : npx tsx scripts/balance-sim.ts [identifiant ...] [--games=60] [--json=chemin.json]
 */
import { writeFileSync } from 'node:fs';
import { gameRegistry } from '@partyhub/games';
import type { GameContext, GameModule, PlayerRef, ScoreEntry } from '@partyhub/shared';

type Status = 'fini' | 'bloquée' | 'trop longue' | 'action refusée en boucle' | 'démarrage refusé';

interface Run {
  status: Status;
  actions: number;
  wins: Map<string, number>;
}

interface GameReport {
  id: string;
  name: string;
  players: number;
  games: number;
  finished: number;
  statuses: Partial<Record<Status, number>>;
  medianActions: number | null;
  seatShare: number[] | null;
  seatZ: number[] | null;
  flags: string[];
}

const MAX_STEPS = Number(process.env.SIM_MAX_STEPS ?? 5000);
/** Délai d’un robot entre deux coups : mêmes valeurs que la salle (room.ts). */
const BOT_MIN_DELAY_MS = 700;
const BOT_JITTER_MS = 1300;
/** Seuil d’écart à la répartition attendue (en écarts-types) : au-delà, la place gagne trop ou trop peu. */
const Z_FLAG = 3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Permutation uniforme (Fisher-Yates), pour que l’ordre des robots ne favorise aucune place. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function playOne(mod: GameModule, seed: number, n: number): Promise<Run> {
  const random = mulberry32(seed);
  const clock = { t: 1_000_000 };
  const timers = new Map<string, number>();
  const players: PlayerRef[] = Array.from({ length: n }, (_, i) => ({
    id: `seat-${i + 1}`,
    name: `Robot ${i + 1}`,
    profileId: null,
  }));
  const ctx: GameContext = {
    now: () => clock.t,
    random,
    schedule: (key, ms) => void timers.set(key, clock.t + ms),
    cancel: (key) => void timers.delete(key),
    connectedPlayerIds: () => players.map((p) => p.id),
  };
  const fail = (status: Status, actions = 0): Run => ({ status, actions, wins: new Map() });

  let state: unknown;
  try {
    const settings = mod.settingsSchema.parse(mod.defaultSettings);
    state = mod.initialize(settings, players, ctx);
    const started = mod.start(state, ctx);
    if (!started.ok) return fail('démarrage refusé');
    state = started.state;
  } catch {
    return fail('démarrage refusé');
  }

  let actions = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    // Minuteurs échus à l’instant courant : le temps passe entre deux coups, comme dans le salon.
    for (const [key, due] of [...timers]) {
      if (due > clock.t) continue;
      timers.delete(key);
      state = mod.onTimer(state, key, ctx);
    }

    if (mod.isFinished(state)) {
      const scores: ScoreEntry[] = mod.calculateScores(state);
      const top = scores.filter((s) => s.rank === 1);
      const wins = new Map<string, number>();
      for (const s of top) wins.set(s.playerId, 1 / top.length);
      return { status: 'fini', actions, wins };
    }

    // Travail asynchrone du jeu (ex. génération) : il s’exécute tout de suite, sans clé d’IA.
    if (mod.pendingJob && mod.runJob && mod.completeJob) {
      const job = mod.pendingJob(state);
      if (job) {
        const outcome = await Promise.resolve()
          .then(() => mod.runJob!(job, ctx, new AbortController().signal))
          .then(
            (value) => ({ ok: true as const, value }),
            (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
          );
        state = mod.completeJob(state, job.id, outcome, ctx);
        continue;
      }
    }

    // Une action de robot, dans un ordre tiré au sort ; une action refusée passe au robot suivant.
    let acted = false;
    let refused = 0;
    for (const p of shuffled(players, random)) {
      const suggestion = mod.suggest?.(state, p.id, random, clock.t) ?? null;
      if (!suggestion) continue;
      const res = mod.handleAction(state, p, suggestion.type, suggestion.payload, ctx);
      if (!res.ok) {
        refused++;
        continue;
      }
      state = res.state;
      actions++;
      acted = true;
      // Le robot attend avant de rejouer, comme dans la salle (700 ms plus une part de hasard).
      clock.t += BOT_MIN_DELAY_MS + Math.floor(random() * BOT_JITTER_MS);
      break;
    }
    if (acted) continue;

    // Personne ne peut agir : on avance l’horloge jusqu’à la prochaine échéance.
    if (timers.size === 0) return fail(refused > 0 ? 'action refusée en boucle' : 'bloquée', actions);
    clock.t = Math.max(clock.t, Math.min(...timers.values()));
  }
  return fail('trop longue', actions);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function simulate(mod: GameModule, games: number, wanted: number): Promise<GameReport> {
  const { id, name, minPlayers, maxPlayers } = mod.manifest;
  const n = Math.max(minPlayers, Math.min(wanted, maxPlayers));
  const report: GameReport = {
    id,
    name,
    players: n,
    games,
    finished: 0,
    statuses: {},
    medianActions: null,
    seatShare: null,
    seatZ: null,
    flags: [],
  };
  if (!mod.suggest) {
    report.flags.push('sans robot : pas de simulation');
    return report;
  }
  if (n < 2) report.flags.push('jeu solo : pas d’équilibre entre places');

  const runs: Run[] = [];
  for (let g = 1; g <= games; g++) runs.push(await playOne(mod, g * 7919 + id.length, n));
  const finishedRuns = runs.filter((r) => r.status === 'fini');
  report.finished = finishedRuns.length;
  for (const r of runs) report.statuses[r.status] = (report.statuses[r.status] ?? 0) + 1;
  report.medianActions = median(finishedRuns.map((r) => r.actions));

  if (n >= 2 && finishedRuns.length > 0) {
    const wins = Array.from({ length: n }, () => 0);
    for (const r of finishedRuns) {
      for (const [playerId, w] of r.wins) wins[Number(playerId.replace('seat-', '')) - 1]! += w;
    }
    const N = finishedRuns.length;
    const p = 1 / n;
    const se = Math.sqrt((p * (1 - p)) / N);
    report.seatShare = wins.map((w) => w / N);
    report.seatZ = report.seatShare.map((s) => (s - p) / se);
    report.seatZ.forEach((z, seat) => {
      if (N >= 30 && Math.abs(z) >= Z_FLAG) {
        const pct = Math.round(report.seatShare![seat]! * 100);
        report.flags.push(`place ${seat + 1} : ${pct} % au lieu de ${Math.round(p * 100)} % (z=${z.toFixed(1)})`);
      }
    });
  }
  const unfinished = games - report.finished;
  if (unfinished > 0) {
    const parts = Object.entries(report.statuses)
      .filter(([status]) => status !== 'fini')
      .map(([status, count]) => `${count} ${status}`);
    report.flags.push(`${unfinished} partie(s) non terminée(s) : ${parts.join(', ')}`);
  }
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const gamesArg = args.find((a) => a.startsWith('--games='));
  const jsonArg = args.find((a) => a.startsWith('--json='));
  const playersArg = args.find((a) => a.startsWith('--players='));
  const games = gamesArg ? Number(gamesArg.split('=')[1]) : 60;
  /** Nombre de places visé (borné par le jeu) : 4 par défaut, 2 pour tester le duel. */
  const wanted = playersArg ? Number(playersArg.split('=')[1]) : 4;
  const only = args.filter((a) => !a.startsWith('--'));
  const targets = gameRegistry.filter(
    (m) => m.manifest.id !== 'plateau-test' && (only.length === 0 || only.includes(m.manifest.id)),
  );

  const reports: GameReport[] = [];
  for (const mod of targets) {
    const r = await simulate(mod, games, wanted);
    reports.push(r);
    const share = r.seatShare ? r.seatShare.map((s) => `${Math.round(s * 100)}`).join('/') : '—';
    const flags = r.flags.length ? ` ⚠ ${r.flags.join(' ; ')}` : '';
    console.log(
      `${r.id.padEnd(18)} ${r.players} j  fin ${String(r.finished).padStart(3)}/${games}  actions≈${r.medianActions ?? '—'}` +
        `  places %: ${share}${flags}`,
    );
  }
  if (jsonArg) writeFileSync(jsonArg.split('=')[1]!, JSON.stringify(reports, null, 2));
}

void main();
