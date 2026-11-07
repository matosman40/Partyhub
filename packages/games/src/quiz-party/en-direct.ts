import { z } from 'zod';
import { photosEnDirect } from '../photo-mystere/en-direct.js';
import { questionsEnDirect } from '../tirage/en-direct.js';
import type { QuizQuestion } from './questions.js';

/**
 * Questions de Quiz Party tirées en direct à chaque partie, pour ne jamais rejouer le même quiz :
 * - Géographie : « Dans quel pays se trouve ce lieu ? » (photo Wikimedia Commons) et « Quelle est la capitale de… ? »
 *   (tous les États souverains de Wikidata) ;
 * - Culture : « Qui a peint ce tableau ? » (Met Museum, CC0) ;
 * - Nature : « Quelle est cette espèce ? » (iNaturalist, crédit affiché).
 * Les images passent par le relais du serveur. Le réseau ne sert que dans le travail hors moteur.
 */

const UA = { 'User-Agent': 'PartyHub/1.0 (jeu de soirée auto-hébergé)' };
const DELAI_MS = 25_000;

function melanger<T>(liste: T[], random: () => number): T[] {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Question à quatre choix : la réponse et trois leurres distincts tirés de `pool`. Null si le pool est trop court. */
export function qcm(
  base: Omit<QuizQuestion, 'choices' | 'answer'>,
  reponse: string,
  pool: string[],
  random: () => number,
): QuizQuestion | null {
  const leurres = melanger([...new Set(pool.filter((p) => p !== reponse))], random).slice(0, 3);
  if (leurres.length < 3) return null;
  const choices = melanger([reponse, ...leurres], random);
  return { ...base, choices, answer: choices.indexOf(reponse) };
}

const capitaleSchema = z.object({
  paysL: z.object({ value: z.string().min(1) }),
  capL: z.object({ value: z.string().min(1) }),
  pays: z.object({ value: z.string() }),
});

/** Capitales des États souverains actuels, en français (une seule capitale par pays). */
async function capitales(
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<{ pays: string; capitale: string; id: string }[]> {
  const q = `SELECT ?pays ?paysL ?capL WHERE {
  ?pays wdt:P31 wd:Q3624078; wdt:P36 ?cap. FILTER NOT EXISTS { ?pays wdt:P576 ?fin }
  ?pays rdfs:label ?paysL. FILTER(LANG(?paysL) = "fr")
  ?cap rdfs:label ?capL. FILTER(LANG(?capL) = "fr")
}`;
  const res = await fetchImpl('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), {
    headers: { ...UA, Accept: 'application/sparql-results+json' },
    signal,
  });
  if (!res.ok) return [];
  const json = JSON.parse(await res.text()) as { results?: { bindings?: unknown[] } };
  const parPays = new Map<string, { pays: string; capitales: Set<string>; id: string }>();
  for (const brut of json.results?.bindings ?? []) {
    const l = capitaleSchema.safeParse(brut);
    if (!l.success) continue;
    const id = l.data.pays.value.split('/').pop() ?? '';
    const e = parPays.get(id) ?? { pays: l.data.paysL.value, capitales: new Set<string>(), id };
    e.capitales.add(l.data.capL.value);
    parPays.set(id, e);
  }
  // Un pays à plusieurs capitales (Bolivie, Afrique du Sud…) n’a pas de réponse unique : il est écarté.
  return [...parPays.values()]
    .filter((e) => e.capitales.size === 1)
    .map((e) => ({ pays: e.pays, capitale: [...e.capitales][0] as string, id: e.id }));
}

/** Tire `nombre` questions neuves, réparties entre les sources qui ont répondu à temps. */
export async function questionsQuizEnDirect(
  nombre: number,
  random: () => number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<QuizQuestion[]> {
  const combine = AbortSignal.any([signal, AbortSignal.timeout(DELAI_MS)]);
  const parSource = Math.max(1, Math.ceil(nombre / 3));
  const [caps, lieux, tirage] = await Promise.allSettled([
    capitales(combine, fetchImpl),
    photosEnDirect(parSource, random, combine, fetchImpl),
    questionsEnDirect(['Peintures', 'Animaux'], parSource, random, combine, fetchImpl),
  ]);
  const groupes: QuizQuestion[][] = [];

  if (caps.status === 'fulfilled' && caps.value.length >= 4) {
    const toutes = caps.value.map((c) => c.capitale);
    const qs: QuizQuestion[] = [];
    for (const c of melanger(caps.value, random).slice(0, parSource)) {
      const q = qcm(
        {
          id: `direct-cap-${c.id}`,
          category: 'Géographie',
          question: `Quelle est la capitale du pays « ${c.pays} » ?`,
        },
        c.capitale,
        toutes,
        random,
      );
      if (q) qs.push(q);
    }
    groupes.push(qs);
  }

  if (lieux.status === 'fulfilled') {
    const paysConnus = [
      ...lieux.value.map((p) => p.country),
      ...(caps.status === 'fulfilled' ? caps.value.map((c) => c.pays) : []),
    ];
    const qs: QuizQuestion[] = [];
    for (const p of lieux.value) {
      const q = qcm(
        {
          id: `direct-${p.id}`,
          category: 'Géographie',
          question: 'Dans quel pays se trouve ce lieu ?',
          explanation: p.place.charAt(0).toLocaleUpperCase('fr') + p.place.slice(1),
          image: { src: p.file, alt: 'Lieu à situer', credit: p.credit, license: p.license, source: p.source },
        },
        p.country,
        paysConnus,
        random,
      );
      if (q) qs.push(q);
    }
    groupes.push(qs);
  }

  if (tirage.status === 'fulfilled') {
    for (const theme of ['Peintures', 'Animaux'] as const) {
      const liste = tirage.value.identifications.filter((q) => q.theme === theme);
      const qs: QuizQuestion[] = [];
      for (const t of liste.slice(0, parSource)) {
        const q = qcm(
          {
            id: `direct-${t.id}`,
            category: theme === 'Peintures' ? 'Culture' : 'Nature',
            question: t.question,
            explanation: theme === 'Peintures' ? `« ${t.titre} »` : t.titre,
            image: {
              src: t.image,
              alt: theme === 'Peintures' ? 'Tableau à identifier' : 'Espèce à identifier',
              credit: t.credit ?? (theme === 'Peintures' ? 'Met Museum' : 'iNaturalist'),
              license: theme === 'Peintures' ? 'CC0' : (t.credit?.split(' · ').pop() ?? 'CC BY'),
              source: t.source,
            },
          },
          t.reponse,
          liste.map((x) => x.reponse),
          random,
        );
        if (q) qs.push(q);
      }
      groupes.push(qs);
    }
  }

  // Tour à tour dans chaque source, pour une partie variée.
  const out: QuizQuestion[] = [];
  for (let i = 0; out.length < nombre && groupes.some((g) => i < g.length); i++) {
    for (const g of groupes) {
      const q = g[i];
      if (q && out.length < nombre) out.push(q);
    }
  }
  return melanger(out, random);
}
