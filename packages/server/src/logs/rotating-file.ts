import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export interface RotatingFileOptions {
  dir: string;
  /** Nom du fichier courant. */
  name?: string;
  /** Taille au-delà de laquelle le fichier courant est mis de côté. */
  maxBytes: number;
  /** Nombre de fichiers gardés en plus du fichier courant (les plus anciens sont supprimés). */
  maxFiles: number;
}

/**
 * Fichier de journal qui tourne : quand il dépasse `maxBytes`, il devient `<nom>.1`, l'ancien `.1`
 * devient `.2`, et ainsi de suite. Écritures synchrones : une erreur fatale est écrite avant l'arrêt.
 */
export class RotatingFile {
  readonly file: string;
  private size: number;

  constructor(private readonly options: RotatingFileOptions) {
    if (options.maxFiles < 1) throw new Error('maxFiles doit être au moins 1');
    mkdirSync(options.dir, { recursive: true });
    this.file = path.join(options.dir, options.name ?? 'partyhub.log');
    this.size = existsSync(this.file) ? statSync(this.file).size : 0;
  }

  write(chunk: string): void {
    const bytes = Buffer.byteLength(chunk);
    if (this.size > 0 && this.size + bytes > this.options.maxBytes) this.rotate();
    appendFileSync(this.file, chunk);
    this.size += bytes;
  }

  /** Tous les fichiers existants, du plus ancien au plus récent. */
  files(): string[] {
    const rotated: string[] = [];
    for (let i = this.options.maxFiles; i >= 1; i--) {
      const candidate = `${this.file}.${i}`;
      if (existsSync(candidate)) rotated.push(candidate);
    }
    return existsSync(this.file) ? [...rotated, this.file] : rotated;
  }

  /** Supprime tout l'historique (fichier courant compris). */
  clear(): void {
    for (const file of this.files()) rmSync(file, { force: true });
    this.size = 0;
  }

  private rotate(): void {
    const { maxFiles } = this.options;
    rmSync(`${this.file}.${maxFiles}`, { force: true });
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`);
    }
    if (existsSync(this.file)) renameSync(this.file, `${this.file}.1`);
    this.size = 0;
  }
}
