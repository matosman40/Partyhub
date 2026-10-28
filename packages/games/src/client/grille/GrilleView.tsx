import type { CSSProperties, ReactNode } from 'react';
import {
  ATTITUDE_POSE,
  type CharacterSpec,
  type EtatGrille,
  type ObjetGrille,
  type PersonnageGrille,
} from '@partyhub/shared';
import { Character } from '../character.js';

/**
 * Plateau en grille, façon Bomberman : murs, caisses, ballons, boîtes, et les personnages du joueur
 * (leur profil, dessiné avec `Character`). L’état vient du serveur ; ce composant ne fait que l’afficher.
 * Réutilisable par tout jeu qui met des personnages sur une grille (voir `shared/grille.ts`).
 */

/** Ce qu’il faut savoir d’un joueur pour le dessiner : son nom, son personnage ou son avatar. */
export interface GrilleApparence {
  name: string;
  character?: CharacterSpec | null;
  /** Repli si le joueur n’a pas de personnage dessiné. */
  avatar?: ReactNode;
  /** Le personnage de cet appareil. */
  mine?: boolean;
  /** Le joueur est hors ligne. */
  away?: boolean;
  tags?: string[];
}

export interface GrilleViewProps {
  etat: EtatGrille;
  /** Apparence de chaque personnage, par identifiant. Un personnage sans apparence porte son identifiant. */
  apparences: Record<string, GrilleApparence>;
  /** Nom du plateau pour les lecteurs d’écran. */
  label: string;
  className?: string;
}

const pct = (n: number, total: number) => `${(n / total) * 100}%`;

/** Le sol et les murs, une case après l’autre. */
function Decor({ etat }: { etat: EtatGrille }) {
  const cases: ReactNode[] = [];
  for (let y = 0; y < etat.hauteur; y++) {
    for (let x = 0; x < etat.largeur; x++) {
      const mur = etat.decor[y]?.[x] === '#';
      cases.push(<span key={`${x}-${y}`} className={mur ? 'grille-case is-mur' : 'grille-case is-sol'} />);
    }
  }
  return (
    <div
      className="grille-decor"
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${etat.largeur}, 1fr)`,
        gridTemplateRows: `repeat(${etat.hauteur}, 1fr)`,
      }}
    >
      {cases}
    </div>
  );
}

function ObjetView({ objet, etat }: { objet: ObjetGrille; etat: EtatGrille }) {
  // Un objet porté suit son porteur : on le dessine juste au-dessus de sa tête.
  const porte = objet.porte !== null;
  return (
    <li
      className={`grille-objet is-${objet.nature}${porte ? ' is-porte' : ''}`}
      data-nature={objet.nature}
      data-porte={porte ? 'oui' : undefined}
      aria-hidden="true"
      style={{
        left: pct(objet.x, etat.largeur),
        top: pct(objet.y, etat.hauteur),
        width: pct(1, etat.largeur),
        height: pct(1, etat.hauteur),
        zIndex: objet.y * 10 + (porte ? 3 : 1),
      }}
    />
  );
}

interface PersonnageProps {
  perso: PersonnageGrille;
  etat: EtatGrille;
  apparence: GrilleApparence;
  /** Vrai si c’est ce personnage qui vient de jouer : son geste est rejoué une fois. */
  actif: boolean;
  seq: number;
}

function PersonnageView({ perso, etat, apparence, actif, seq }: PersonnageProps) {
  const pose = ATTITUDE_POSE[perso.attitude];
  // Le personnage regarde à gauche ou à droite ; haut et bas gardent le dernier sens horizontal.
  const sens = perso.dir === 'left' ? -1 : 1;
  const classes = ['grille-personnage'];
  if (apparence.mine) classes.push('is-own');
  if (apparence.away) classes.push('is-away');
  if (actif) classes.push(`is-geste-${perso.attitude}`);
  const style: CSSProperties = {
    left: pct(perso.x, etat.largeur),
    top: pct(perso.y, etat.hauteur),
    width: pct(1, etat.largeur),
    height: pct(1, etat.hauteur),
    zIndex: perso.y * 10 + 2,
  };
  return (
    <li
      className={classes.join(' ')}
      style={style}
      data-id={perso.id}
      data-x={perso.x}
      data-y={perso.y}
      data-dir={perso.dir}
      data-attitude={perso.attitude}
      aria-label={`${apparence.name}${apparence.mine ? ' (vous)' : ''}`}
    >
      <div className="grille-face" style={{ transform: `scaleX(${sens})` }}>
        {/* La clé suit le dernier geste : l’animation se rejoue à chaque nouveau pas. */}
        <div className="grille-bob" key={actif ? `geste-${seq}` : 'repos'}>
          {apparence.character ? (
            <Character spec={apparence.character} mood={pose} framing="full" />
          ) : (
            (apparence.avatar ?? <span className="grille-initiale">{apparence.name.slice(0, 1)}</span>)
          )}
        </div>
      </div>
      <span className="grille-nom">
        <span>{apparence.name}</span>
        {apparence.tags?.map((t) => (
          <span key={t} className="grille-tag">
            {t}
          </span>
        ))}
      </span>
    </li>
  );
}

/**
 * Le plateau et ses personnages. Chaque personnage a une case ; un pas ou un geste est joué sur
 * l’état reçu. Les personnages sans apparence fournie sont tout de même placés, avec leur identifiant.
 */
export function GrilleView({ etat, apparences, label, className }: GrilleViewProps) {
  const personnages = Object.values(etat.personnages);
  return (
    <div
      className={`grille${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
      style={{ '--cols': etat.largeur, '--rows': etat.hauteur } as CSSProperties}
    >
      <Decor etat={etat} />
      {/* Objets et personnages dans une même liste : l’ordre d’affichage suit la ligne de chaque case. */}
      <ol className="grille-scene">
        {etat.objets.map((o) => (
          <ObjetView key={o.id} objet={o} etat={etat} />
        ))}
        {personnages.map((perso) => (
          <PersonnageView
            key={perso.id}
            perso={perso}
            etat={etat}
            apparence={apparences[perso.id] ?? { name: perso.id }}
            actif={etat.dernier?.joueur === perso.id}
            seq={etat.seq}
          />
        ))}
      </ol>
    </div>
  );
}
