import type { HostViewProps } from '../../client/types.js';

export interface EtapeAffichee {
  id: string;
  libelle: string;
}

export interface JoueurAffiche {
  id: string;
  nom: string;
  resultats: (boolean | null)[];
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
}: {
  etapes: EtapeAffichee[];
  joueurs: JoueurAffiche[];
  etape: string | null;
  /** Identifiant du téléphone qui affiche le tableau : sa ligne est mise en évidence. */
  moi?: string;
}) {
  if (joueurs.length === 0) return <p className="muted">Aucun téléphone dans la salle.</p>;
  return (
    <table className="essai-table">
      <thead>
        <tr>
          <th scope="col">Téléphone</th>
          {etapes.map((e) => (
            <th key={e.id} scope="col" aria-current={e.id === etape ? 'step' : undefined}>
              {e.libelle}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {joueurs.map((j) => (
          <tr key={j.id} className={j.id === moi ? 'essai-moi' : undefined}>
            <th scope="row">{j.nom}</th>
            {j.resultats.map((r, i) => (
              <td key={etapes[i].id}>{r === true ? '✔ réussi' : r === false ? '✘ échec' : '…'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Écran principal : le tableau, et l’essai en cours. */
export function EssaiHost({ publicState: pub, hostState }: HostViewProps) {
  if (!pub) return null;
  const etapes = pub.etapes as EtapeAffichee[];
  const etape = pub.etape as string | null;
  const actuelle = etapes.find((e) => e.id === etape);
  const attente = (hostState?.attente as string[] | undefined) ?? [];

  const titre =
    pub.phase === 'ready'
      ? 'Essai des appareils'
      : pub.phase === 'final'
        ? 'Bilan des essais'
        : `Essai : ${actuelle?.libelle ?? ''} (${(pub.index as number) + 1} sur ${etapes.length})`;

  return (
    <section className="quiz-host fade-in">
      <h2 className="question-title">{titre}</h2>
      {pub.phase === 'essai' && (
        <p className="muted" role="status">
          {pub.repondus as number} / {pub.total as number} téléphones ont répondu
        </p>
      )}

      <EssaiTableau etapes={etapes} joueurs={pub.joueurs as JoueurAffiche[]} etape={etape} />

      {pub.phase === 'essai' && attente.length > 0 && <p className="muted">En attente : {attente.join(', ')}</p>}
      {pub.phase === 'final' && (
        <p className="notice">
          Un échec veut dire que l’essai n’a pas réussi sur ce téléphone : vérifiez l’autorisation du navigateur, ou
          l’appareil lui-même.
        </p>
      )}
    </section>
  );
}
