import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou d'accessibilité : un élément générique (div, span, p) ne porte pas de nom sans rôle.
 * Un `aria-label` sur un tel élément est ignoré, ou signalé par axe-core comme violation. Chaque
 * élément nommé doit donc avoir un rôle explicite (img, group, meter, status…).
 *
 * Analyse textuelle des balises d'ouverture JSX (pas de compilation) : elle accepte des expressions
 * d'attributs imbriquées, comme `aria-label={`Dé : ${d}`}`.
 */

const SRC_ROOTS = [join(__dirname, '..', '..', '..', 'games', 'src'), join(__dirname, '..')];
const OPENING = /<(div|span|p)\b((?:[^>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : tsxFiles(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

/** Balises génériques nommées sans rôle, sous la forme « fichier:ligne <balise> ». */
function unnamedGenerics(): string[] {
  const found: string[] = [];
  for (const root of SRC_ROOTS) {
    for (const file of tsxFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(OPENING)) {
        const attrs = match[2] ?? '';
        if (/\baria-label=/.test(attrs) && !/\brole=/.test(attrs)) {
          const line = text.slice(0, match.index).split('\n').length;
          found.push(`${relative(join(__dirname, '..', '..', '..', '..'), file)}:${line} <${match[1]}>`);
        }
      }
    }
  }
  return found;
}

describe('Rôles des éléments nommés', () => {
  it('aucun div, span ou p ne porte un nom sans rôle explicite', () => {
    expect(unnamedGenerics()).toEqual([]);
  });
});
