import type { HostViewProps } from '../../client/types.js';

export interface EtapeAffichee {
  id: string;
  libelle: string;
  icone: string;
}

export interface JoueurAffiche {
  id: string;
  nom: string;
  resultats: (boolean | null)[];
}

/**
 * Une case du tableau : réussi, échec, ou pas encore de réponse. En mode compact, seule l’icône reste visible, et
 * la pastille porte son libellé pour les lecteurs d’écran.
 */
function Resultat({ r, compact }: { r: boolean | null; compact: boolean }) {
  const etat =
    r === true
      ? { classe: 'is-ok', icone: '✔', texte: 'réussi' }
      : r === false
        ? { classe: 'is-ko', icone: '✘', texte: 'échec' }
        : { classe: 'is-attente', icone: '·', texte: 'en attente' };
  const visible = compact ? etat.icone : r === null ? etat.texte : `${etat.icone} ${etat.texte}`;
  const libelle = compact ? { role: 'img' as const, 'aria-label': etat.texte } : {};
  return (
    <span className={`essai-chip ${etat.classe}`} {...libelle}>
      {visible}
    </span>
  );
}

/**
 * Tableau des résultats : une ligne par téléphone, une colonne par essai. Partagé par l’écran principal et par
 * le bilan du téléphone, pour que la salle sans écran voie aussi les résultats.
 */
export function EssaiTableau({
  etapes,
  joueurs,
  etape,
  moi,
  compact = false,
}: {
  etapes: EtapeAffichee[];
  joueurs: JoueurAffiche[];
  etape: string | null;
  /** Identifiant du téléphone qui affiche le tableau : sa ligne est mise en évidence. */
  moi?: string;
  /** Téléphone étroit : icônes seules, pour que toutes les colonnes tiennent à l’écran. */
  compact?: boolean;
}) {
  if (joueurs.length === 0) return <p className="essai-texte">Aucun téléphone dans la salle.</p>;
  return (
    <div className="essai-tableau-cadre">
      <table className={compact ? 'essai-tableau is-compact' : 'essai-tableau'}>
        <thead>
          <tr>
            <th scope="col">{compact ? <span className="sr-only">Téléphone</span> : 'Téléphone'}</th>
            {etapes.map((e) => (
              <th
                key={e.id}
                scope="col"
                className={e.id === etape ? 'is-courant' : undefined}
                aria-current={e.id === etape ? 'step' : undefined}
                title={e.libelle}
              >
                {compact ? (
                  <>
                    <span aria-hidden="true">{e.icone}</span>
                    <span className="sr-only">{e.libelle}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">{e.icone}</span> {e.libelle}
                  </>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {joueurs.map((j) => (
            <tr key={j.id} className={j.id === moi ? 'is-moi' : undefined}>
              <th scope="row">
                <span className="essai-nom">{j.nom}</span>
                {j.id === moi && !compact && <small> (vous)</small>}
              </th>
              {j.resultats.map((r, i) => (
                <td key={etapes[i].id}>
                  <Resultat r={r} compact={compact} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Écran principal : l’essai en cours, la progression des réponses, puis le tableau. */
export function EssaiHost({ publicState: pub, hostState }: HostViewProps) {
  if (!pub) return null;
  const etapes = pub.etapes as EtapeAffichee[];
  const joueurs = pub.joueurs as JoueurAffiche[];
  const etape = pub.etape as string | null;
  const actuelle = etapes.find((e) => e.id === etape);
  const attente = (hostState?.attente as string[] | undefined) ?? [];
  const total = pub.total as number;
  const repondus = pub.repondus as number;
  const pourcent = total > 0 ? Math.round((repondus / total) * 100) : 0;

  if (pub.phase === 'ready') {
    return (
      <section className="essai-ecran-hote fade-in">
        <h2 className="essai-titre-grand">Essai des appareils</h2>
        <ol className="essai-parcours" aria-label="Les essais">
          {etapes.map((e) => (
            <li key={e.id} className="is-a-venir">
              <span aria-hidden="true">{e.icone}</span>
              <small>{e.libelle}</small>
            </li>
          ))}
        </ol>
        <p className="essai-texte">Chaque téléphone fait les essais, puis déclare son résultat.</p>
      </section>
    );
  }

  return (
    <section className="essai-ecran-hote fade-in">
      {pub.phase === 'essai' && actuelle && (
        <header className="essai-entete">
          <span className="essai-entete-icone" aria-hidden="true">
            {actuelle.icone}
          </span>
          <div>
            <p className="essai-compteur">
              Essai {(pub.index as number) + 1} sur {etapes.length}
            </p>
            <h2 className="essai-titre-grand">{actuelle.libelle}</h2>
          </div>
        </header>
      )}
      {pub.phase === 'final' && <h2 className="essai-titre-grand">Bilan des essais</h2>}

      {pub.phase === 'essai' && (
        <div className="essai-avancement" role="status">
          <div className="essai-progress" aria-hidden="true">
            <span style={{ width: `${pourcent}%` }} />
          </div>
          <p className="essai-texte">
            {repondus} / {total} téléphones ont répondu
            {attente.length > 0 && ` · en attente : ${attente.join(', ')}`}
          </p>
        </div>
      )}

      <EssaiTableau etapes={etapes} joueurs={joueurs} etape={etape} />

      {pub.phase === 'final' && (
        <p className="essai-note">
          Un échec veut dire que l’essai n’a pas réussi sur ce téléphone : vérifiez l’autorisation du navigateur, ou
          l’appareil lui-même.
        </p>
      )}
    </section>
  );
}
