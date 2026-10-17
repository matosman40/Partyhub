import { readFileSync } from 'node:fs';
import type { RotatingFile } from './rotating-file.js';

/** Ordre des niveaux pino, pour filtrer « avertissements et plus ». */
const LEVEL_RANK: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export type JournalMinLevel = 'all' | 'warn' | 'error';

export interface JournalEntry {
  time: string;
  level: string;
  source: string;
  event: string;
  message: string;
  /** Champs propres à l’entrée (salle, chemin, navigateur, pile d’appels…). */
  details: Record<string, unknown>;
}

export interface JournalQuery {
  minLevel?: JournalMinLevel;
  source?: string;
  /** Sous-chaîne recherchée dans l’événement, le message et les détails. */
  text?: string;
  limit?: number;
}

export interface JournalGroup {
  level: string;
  event: string;
  message: string;
  count: number;
  lastSeen: string;
}

export interface JournalResult {
  entries: JournalEntry[];
  /** Nombre d’entrées correspondant aux filtres, avant la limite. */
  matched: number;
  /** Entrées regroupées par type (même événement, même message aux chiffres près). */
  groups: JournalGroup[];
  files: number;
  sizeBytes: number;
}

const STANDARD_KEYS = new Set(['level', 'time', 'pid', 'hostname', 'app', 'msg', 'event', 'source', 'v']);

/** Transforme une ligne JSON de pino en entrée lisible. Une ligne illisible est ignorée. */
export function parseLine(line: string): JournalEntry | null {
  if (!line.trim()) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!STANDARD_KEYS.has(key)) details[key] = value;
  }
  return {
    time: typeof raw.time === 'string' ? raw.time : '',
    level: typeof raw.level === 'string' ? raw.level : 'info',
    source: typeof raw.source === 'string' ? raw.source : 'server',
    event: typeof raw.event === 'string' ? raw.event : 'app',
    message: typeof raw.msg === 'string' ? raw.msg : '',
    details,
  };
}

function matches(entry: JournalEntry, query: JournalQuery): boolean {
  const minRank = query.minLevel === 'error' ? 50 : query.minLevel === 'warn' ? 40 : 0;
  if ((LEVEL_RANK[entry.level] ?? 0) < minRank) return false;
  if (query.source && entry.source !== query.source) return false;
  if (query.text) {
    const needle = query.text.toLowerCase();
    const haystack = `${entry.event} ${entry.message} ${JSON.stringify(entry.details)}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Regroupe les erreurs semblables : les chiffres sont effacés pour que « salle 1234 » et « salle 5678 » se confondent. */
export function groupEntries(entries: JournalEntry[], limit = 15): JournalGroup[] {
  const groups = new Map<string, JournalGroup>();
  for (const entry of entries) {
    const message = entry.message.replace(/\d+/g, '#').slice(0, 160);
    const key = `${entry.level}|${entry.event}|${message}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (entry.time > current.lastSeen) current.lastSeen = entry.time;
    } else {
      // Le message affiché est celui d’une vraie occurrence ; seule la clé efface les chiffres.
      groups.set(key, {
        level: entry.level,
        event: entry.event,
        message: entry.message.slice(0, 160),
        count: 1,
        lastSeen: entry.time,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen)).slice(0, limit);
}

/**
 * Lit tout le journal (tous les fichiers tournants) et applique les filtres. Les plus récentes d’abord.
 * Lecture synchrone : un journal borné (quelques dizaines de Mo) reste rapide à relire pour l’administrateur.
 */
export function readJournal(journal: RotatingFile, query: JournalQuery = {}): JournalResult {
  const files = journal.files();
  const all: JournalEntry[] = [];
  let sizeBytes = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    sizeBytes += Buffer.byteLength(text);
    for (const line of text.split('\n')) {
      const entry = parseLine(line);
      if (entry && matches(entry, query)) all.push(entry);
    }
  }
  // Les fichiers sont lus du plus ancien au plus récent : on inverse pour afficher le plus récent en premier.
  all.reverse();
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
  return {
    entries: all.slice(0, limit),
    matched: all.length,
    groups: groupEntries(all.filter((e) => (LEVEL_RANK[e.level] ?? 0) >= 40)),
    files: files.length,
    sizeBytes,
  };
}
