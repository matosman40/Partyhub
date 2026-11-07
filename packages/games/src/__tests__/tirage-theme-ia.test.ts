import { afterEach, describe, expect, it, vi } from 'vitest';
import { tirageSurprise } from '../tirage/module.js';
import { formesDeRecherche, suggererTermes, type ResultatLibre } from '../tirage/theme-libre.js';
import { A, B, mulberry32, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

/**
 * Thème libre de Tirage surprise : l'IA de l'installation aide seulement à comprendre le thème (des termes de
 * recherche). Les questions et les réponses viennent de Wikidata, simulé ici par un faux `fetch`.
 */

describe('thème libre : aide de l’IA pour comprendre le thème', () => {
  const signal = () => new AbortController().signal;
  const ia = (reponse: string | Error, disponible = true) => ({
    complete: vi.fn(async () => {
      if (reponse instanceof Error) throw reponse;
      return reponse;
    }),
    available: () => disponible,
  });

  it('garde au plus trois termes nettoyés, sans doublon ni terme trop court', async () => {
    const h = harness({ ai: ia('{"termes":["Fleuve !!","fleuve","x","river","cours d’eau","stream"]}') });
    expect(await suggererTermes(h.ctx, 'les grands fleuves', signal())).toEqual(['fleuve', 'river', 'cours d eau']);
  });

  it('renvoie une liste vide sans IA, si elle est coupée, en erreur ou hors format', async () => {
    expect(await suggererTermes(harness().ctx, 'fleuves', signal())).toEqual([]);
    const coupee = ia('{"termes":["fleuve"]}', false);
    expect(await suggererTermes(harness({ ai: coupee }).ctx, 'fleuves', signal())).toEqual([]);
    expect(coupee.complete).not.toHaveBeenCalled();
    expect(await suggererTermes(harness({ ai: ia(new Error('quota')) }).ctx, 'fleuves', signal())).toEqual([]);
    expect(await suggererTermes(harness({ ai: ia('pas de JSON') }).ctx, 'fleuves', signal())).toEqual([]);
    expect(await suggererTermes(harness({ ai: ia('{"autre":1}') }).ctx, 'fleuves', signal())).toEqual([]);
  });

  it('n’appelle pas l’IA pour un thème invalide, et lui envoie le thème nettoyé', async () => {
    const client = ia('{"termes":["fleuve"]}');
    expect(await suggererTermes(harness({ ai: client }).ctx, 'ab', signal())).toEqual([]);
    expect(client.complete).not.toHaveBeenCalled();
    await suggererTermes(harness({ ai: client }).ctx, '  Fleuves <script> ', signal());
    const envoye = (client.complete.mock.calls[0] as unknown as [{ user: string }])[0].user;
    expect(envoye).toBe('Thème : « fleuves script »');
  });

  it('cherche le thème tapé, son singulier, puis les termes de l’IA en français et en anglais', () => {
    expect(formesDeRecherche('fleuves', ['fleuve', 'river'])).toEqual([
      { texte: 'fleuves', langue: 'fr' },
      { texte: 'fleuve', langue: 'fr' },
      { texte: 'fleuve', langue: 'en' },
      { texte: 'river', langue: 'fr' },
      { texte: 'river', langue: 'en' },
    ]);
  });
});

describe('thème libre : travail complet, Wikidata simulé', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const liens = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`wiki${i}`, {}]));
  const pays = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
  const longueur = (km: number) => ({
    mainsnak: { datavalue: { value: { amount: `+${km}`, unit: 'http://www.wikidata.org/entity/Q828224' } } },
  });
  const riviere = (id: string, nom: string, claims: Record<string, unknown>) => ({
    id,
    labels: { fr: { value: nom } },
    sitelinks: liens,
    claims,
  });
  const fiches: Record<string, unknown> = {
    Q1: riviere('Q1', 'Loire', { P17: [pays('Q142')] }),
    Q2: riviere('Q2', 'Volga', { P17: [pays('Q159')], P2043: [longueur(3530)] }),
    Q3: riviere('Q3', 'Tage', { P17: [pays('Q45')] }),
    Q4: riviere('Q4', 'Elbe', { P17: [pays('Q183')] }),
    Q5: riviere('Q5', 'Pô', { P17: [pays('Q38')], P2043: [longueur(652)] }),
    Q6: riviere('Q6', 'Danube', { P17: [pays('Q28'), pays('Q218')] }),
    Q142: { id: 'Q142', labels: { fr: { value: 'France' } } },
    Q159: { id: 'Q159', labels: { fr: { value: 'Russie' } } },
    Q45: { id: 'Q45', labels: { fr: { value: 'Portugal' } } },
    Q183: { id: 'Q183', labels: { fr: { value: 'Allemagne' } } },
    Q38: { id: 'Q38', labels: { fr: { value: 'Italie' } } },
  };

  /** Faux Wikidata : recherche, comptage, liste de la classe et fiches, selon l'adresse appelée. */
  function fauxWikidata(url: string): unknown {
    const u = new URL(url);
    const action = u.searchParams.get('action');
    if (action === 'wbsearchentities') {
      const texte = u.searchParams.get('search') ?? '';
      const trouve = ['fleuve', 'river'].includes(texte);
      return { search: [trouve ? { id: 'Q4022', label: 'fleuve' } : { id: 'Q999', label: 'liste de fleuves' }] };
    }
    if (action === 'wbgetentities') {
      const ids = (u.searchParams.get('ids') ?? '').split('|').filter((id) => fiches[id]);
      return { entities: Object.fromEntries(ids.map((id) => [id, fiches[id]])) };
    }
    const requete = u.searchParams.get('query') ?? '';
    if (requete.includes('COUNT')) {
      return { results: { bindings: [{ n: { value: requete.includes('wd:Q4022') ? '5000' : '0' } }] } };
    }
    const ids = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
    return { results: { bindings: ids.map((id) => ({ e: { value: `http://www.wikidata.org/entity/${id}` } })) } };
  }

  function simulerWikidata(): string[] {
    const appels: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        appels.push(url);
        return new Response(JSON.stringify(fauxWikidata(url)), { status: 200 });
      }),
    );
    return appels;
  }

  const job = { id: 'theme:les grands fleuves', kind: 'theme-libre', input: { theme: 'les grands fleuves' } };

  it('avec l’IA, trouve la classe par ses termes ; questions et réponses viennent de Wikidata', async () => {
    const appels = simulerWikidata();
    const h = harness({ ai: { complete: async () => '{"termes":["fleuve","river"]}', available: () => true } });
    const r = (await tirageSurprise.runJob!(job, h.ctx, new AbortController().signal)) as ResultatLibre;
    expect(r.classe).toBe('Q4022');
    expect(r.classeNom).toBe('fleuve');
    expect(r.termesIa).toEqual(['fleuve', 'river']);
    expect(r.estimations.map((e) => e.valeur).sort((a, b) => a - b)).toEqual([652, 3530]);
    expect(r.entrees.map((q) => q.titre).sort()).toEqual(['Elbe', 'Loire', 'Tage']);
    // Le Danube traverse deux pays : il est écarté, faute de réponse unique.
    expect(JSON.stringify(r)).not.toContain('Danube');
    expect(appels.some((a) => a.includes('search=fleuve'))).toBe(true);
  });

  it('sans IA, le thème tapé ne trouve qu’une liste : le travail échoue, la partie reprend les thèmes cochés', async () => {
    simulerWikidata();
    const h = harness();
    await expect(tirageSurprise.runJob!(job, h.ctx, new AbortController().signal)).rejects.toThrow(
      /trop peu documentée/,
    );
  });

  it('montre à l’hôte la classe retenue', () => {
    const h = harness({ connected: [A.id, B.id], random: mulberry32(3) });
    const init = tirageSurprise.initialize(
      { enDirect: false, rounds: 3, guessSeconds: 60, difficulty: 2, themeLibre: 'fleuves' },
      [A, B],
      h.ctx,
    );
    const attente = must(tirageSurprise.start(init, h.ctx));
    const question = (id: string, titre: string, reponse: string) => ({
      id,
      question: `Dans quel pays se trouve « ${titre} » ?`,
      reponse,
      leurres: ['Chine', 'Inde', 'Brésil'],
      titre,
      source: `https://www.wikidata.org/wiki/${id}`,
    });
    const valeur = {
      theme: 'fleuves',
      classe: 'Q4022',
      classeNom: 'fleuve',
      termesIa: ['fleuve'],
      entrees: [
        question('libre-Q1', 'Loire', 'France'),
        question('libre-Q3', 'Tage', 'Portugal'),
        question('libre-Q4', 'Elbe', 'Allemagne'),
        question('libre-Q7', 'Shannon', 'Irlande'),
      ],
    };
    const s = tirageSurprise.completeJob!(attente, 'theme:fleuves', { ok: true, value: valeur }, h.ctx);
    expect(s.libre?.classe).toBe('fleuve');
    const pub = tirageSurprise.getPublicState(s) as { libre: { classe: string | null } };
    expect(pub.libre.classe).toBe('fleuve');
  });
});
