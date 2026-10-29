import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  actionContextuelle,
  devantLePersonnage,
  themeDePlateau,
  type ActionGrille,
  type Devant,
  type Direction,
  type EtatGrille,
  type ThemeId,
} from '@partyhub/shared';

/**
 * Manette d’un personnage sur le plateau en grille, façon console : une croix de direction, et trois
 * boutons. La croix marche. « Action » fait ce qu’il faut selon ce qui est devant (prendre, poser,
 * pousser). « Sauter » saute par-dessus la case devant. « Saluer » salue. La bande du haut dit ce qui
 * est devant le personnage. Tout est transparent : le plateau reste visible derrière.
 *
 * Au clavier : flèches pour marcher, Espace pour Action, Entrée pour Sauter, S pour Saluer.
 */

const DIRECTIONS: Array<{ dir: Direction; label: string; fleche: string; cle: string }> = [
  { dir: 'up', label: 'haut', fleche: '↑', cle: 'ArrowUp' },
  { dir: 'left', label: 'gauche', fleche: '←', cle: 'ArrowLeft' },
  { dir: 'right', label: 'droite', fleche: '→', cle: 'ArrowRight' },
  { dir: 'down', label: 'bas', fleche: '↓', cle: 'ArrowDown' },
];

/** Ce que dit la bande du haut, selon ce qui est devant. */
export function libelleDevant(devant: Devant | 'plateforme' | null, portant: boolean): string {
  if (portant) return 'Vous portez une boîte : Action la pose devant vous';
  switch (devant) {
    case 'mur':
      return 'Un mur devant vous';
    case 'personnage':
      return 'Quelqu’un devant vous';
    case 'caisse':
      return 'Une caisse devant vous : Action la pousse';
    case 'ballon':
      return 'Un ballon devant vous : Action le pousse';
    case 'boite':
      return 'Une boîte devant vous : Action la prend';
    case 'plateforme':
      return 'Plateforme devant vous : Sauter pour monter';
    case 'rien':
      return 'Rien devant vous';
    default:
      return 'Vous n’êtes pas sur le plateau';
  }
}

/** Ce que le clavier peut déclencher sur la manette. */
export type ActionTouche =
  { type: 'marcher'; dir: Direction } | { type: 'action' } | { type: 'sauter' } | { type: 'saluer' };

/** Ce qu’il faut savoir de la cible d’une touche (sans DOM, pour tester la règle). */
export interface CibleTouche {
  /** Nom de balise en majuscules (BUTTON, A, INPUT…). */
  tag: string;
  role?: string | null;
  /** Zone éditable (contentEditable). */
  editable?: boolean;
  /** La cible est dans une boîte de dialogue. */
  dansDialogue?: boolean;
}

export interface ToucheInfo {
  key: string;
  repeat?: boolean;
  defaultPrevented?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  cible?: CibleTouche | null;
}

/** Délai minimal entre deux gestes envoyés au clavier (ms). */
export const DELAI_GESTE_MS = 150;

/** Durée d’affichage d’un message de la bande (ms). */
export const DUREE_MESSAGE_MS = 4000;

const SAISIE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const INTERACTIF = new Set(['BUTTON', 'A', 'SELECT']);

/**
 * Traduit une frappe en geste, ou null si la frappe ne regarde pas la manette : déjà traitée par un
 * autre élément, combinée à Ctrl/Cmd/Alt, dans un champ de saisie. Espace et Entrée gardent leur sens
 * natif sur un bouton, un lien, une liste ou une boîte de dialogue. Une touche maintenue enfoncée ne
 * répète que la marche : les autres gestes demandent une nouvelle pression.
 */
export function actionDepuisTouche(t: ToucheInfo): ActionTouche | null {
  if (t.defaultPrevented || t.ctrlKey || t.metaKey || t.altKey) return null;
  const c = t.cible ?? null;
  if (c && (SAISIE.has(c.tag) || c.editable)) return null;
  const d = DIRECTIONS.find((x) => x.cle === t.key);
  if (d) return { type: 'marcher', dir: d.dir };
  if (t.repeat) return null;
  if (t.key === ' ' || t.key === 'Enter') {
    if (c && (INTERACTIF.has(c.tag) || c.role === 'button' || c.role === 'dialog' || c.dansDialogue)) return null;
    return t.key === ' ' ? { type: 'action' } : { type: 'sauter' };
  }
  if (t.key === 's' || t.key === 'S') return { type: 'saluer' };
  return null;
}

/** Décrit la cible d’un événement clavier pour `actionDepuisTouche`. */
function decrireCible(cible: EventTarget | null): CibleTouche | null {
  if (!(cible instanceof HTMLElement)) return null;
  const el = cible.closest<HTMLElement>('button, a, select, [role="button"]') ?? cible;
  return {
    tag: el.tagName,
    role: el.getAttribute('role'),
    editable: cible.isContentEditable,
    dansDialogue: cible.closest('[role="dialog"]') !== null,
  };
}

/**
 * Rend inerte tout ce qui entoure l’élément (la manette couvre la page : Tab ne doit pas passer dessous).
 * Le menu du coin reste actif. Retourne la fonction qui remet les éléments dans leur état.
 */
function isolerDuReste(el: HTMLElement): () => void {
  const rendus: HTMLElement[] = [];
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    for (const frere of Array.from(n.parentElement?.children ?? [])) {
      if (!(frere instanceof HTMLElement) || frere === n || frere.inert) continue;
      if (frere.tagName === 'SCRIPT' || frere.tagName === 'STYLE') continue;
      if (frere.matches('.corner-button, .corner-scrim, .corner-drawer')) continue;
      frere.inert = true;
      rendus.push(frere);
    }
  }
  return () => {
    for (const r of rendus) r.inert = false;
  };
}

export interface GrilleControleurProps {
  etat: EtatGrille;
  /** Identifiant du personnage de cet appareil. */
  moi: string;
  /** Envoie le geste. Retourne le message d’erreur (refus du plateau), ou null si le geste est accepté. */
  onAction: (action: ActionGrille) => Promise<string | null>;
  disabled?: boolean;
  /** Les touches du clavier pilotent le personnage (ordinateur). */
  clavier?: boolean;
  /** Le plateau lui-même, dessiné sous les commandes. */
  children: ReactNode;
  /** Décor du plateau : il colore aussi la manette. */
  theme?: ThemeId;
  /**
   * Actions secondaires (émotions, gestes de jeu…), cachées dans un tiroir qui monte depuis le bas.
   * Absent : pas de tiroir.
   */
  tiroir?: ReactNode;
  /** Avis à garder visibles dans la bande du haut (connexion perdue, retour au départ…). */
  avis?: ReactNode;
}

export function GrilleControleur({
  etat,
  moi,
  onAction,
  disabled = false,
  clavier = true,
  children,
  theme,
  tiroir,
  avis,
}: GrilleControleurProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLElement>(null);
  const poignee = useRef<HTMLButtonElement>(null);
  const dernierGeste = useRef(0);
  const tiroirId = useId();
  const t = themeDePlateau(theme);
  const perso = etat.personnages[moi];
  const portant = etat.objets.some((o) => o.porte === moi);
  const devant = devantLePersonnage(etat, moi);

  async function envoyer(action: ActionGrille) {
    if (disabled) return;
    setMessage(await onAction(action));
  }

  function action() {
    const a = actionContextuelle(etat, moi);
    if (!a) {
      setMessage('Rien à faire ici.');
      return;
    }
    void envoyer(a);
  }

  function sauter() {
    if (!perso) return;
    void envoyer({ type: 'sauter', dir: perso.dir });
  }

  // Un message de la bande s’efface après un délai.
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), DUREE_MESSAGE_MS);
    return () => window.clearTimeout(id);
  }, [message]);

  // La manette couvre la page : le reste devient inerte pour que Tab ne passe pas dessous.
  useEffect(() => {
    const el = racine.current;
    return el ? isolerDuReste(el) : undefined;
  }, []);

  // Échap referme le tiroir ouvert et rend le focus à sa poignée.
  useEffect(() => {
    if (!ouvert) return;
    function onEchap(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setOuvert(false);
      poignee.current?.focus();
    }
    window.addEventListener('keydown', onEchap);
    return () => window.removeEventListener('keydown', onEchap);
  }, [ouvert]);

  // Seul ce qui est utile à entendre est annoncé : ce qu’on peut prendre ou pousser, pas « rien devant vous ».
  const devantUtile =
    portant || devant === 'caisse' || devant === 'ballon' || devant === 'boite' || (devant as string) === 'plateforme';
  const texteDevant = libelleDevant(devant, portant);
  const [annonceDevant, setAnnonceDevant] = useState<string | null>(null);
  useEffect(() => {
    if (!devantUtile) {
      setAnnonceDevant(null);
      return;
    }
    setAnnonceDevant(texteDevant);
    const id = window.setTimeout(() => setAnnonceDevant(null), DUREE_MESSAGE_MS);
    return () => window.clearTimeout(id);
  }, [devantUtile, texteDevant]);

  // Les touches suivent l’état courant : l’écouteur est refait à chaque changement de plateau.
  useEffect(() => {
    if (!clavier || disabled) return;
    function onKey(e: KeyboardEvent) {
      const t = actionDepuisTouche({
        key: e.key,
        repeat: e.repeat,
        defaultPrevented: e.defaultPrevented,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        cible: decrireCible(e.target),
      });
      if (!t) return;
      if (t.type !== 'saluer') e.preventDefault();
      // Les gestes sont espacés : une frappe trop rapprochée de la précédente est ignorée.
      const maintenant = Date.now();
      if (maintenant - dernierGeste.current < DELAI_GESTE_MS) return;
      dernierGeste.current = maintenant;
      if (t.type === 'action') action();
      else if (t.type === 'sauter') sauter();
      else void envoyer(t);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Les fonctions lisent l’état courant : elles sont recréées à chaque rendu, ce qui est voulu ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavier, disabled, etat, onAction]);

  return (
    <section
      ref={racine}
      className={`grille-console${ouvert ? ' is-ouvert' : ''}`}
      aria-label="Manette du personnage"
      style={{ '--fond': t.fond, '--ciel': t.ciel } as CSSProperties}
    >
      <div className="grille-plateau">{children}</div>

      <div className="grille-haut">
        <div className="grille-bande">
          <span className="grille-bande-devant">{texteDevant}</span>
          {message && <span className="grille-bande-message">{message}</span>}
          {avis}
        </div>
        {tiroir && (
          <button
            type="button"
            ref={poignee}
            className="grille-tiroir-poignee"
            aria-expanded={ouvert}
            aria-controls={tiroirId}
            onClick={() => setOuvert((o) => !o)}
          >
            <span aria-hidden="true">{ouvert ? '⌄' : '⌃'}</span> {ouvert ? 'Fermer' : 'Plus d’actions'}
          </button>
        )}
      </div>
      {/* Seule zone annoncée : le message, sinon ce qui est utile devant le personnage. */}
      <p className="sr-only" role="status" aria-live="polite">
        {message ?? annonceDevant ?? ''}
      </p>

      <div className="grille-manette">
        <div className="grille-croix" role="group" aria-label="Direction">
          {DIRECTIONS.map((d) => (
            <button
              key={d.dir}
              type="button"
              className={`grille-bouton grille-croix-${d.dir}`}
              aria-label={`Aller vers ${d.label}`}
              disabled={disabled}
              onClick={() => void envoyer({ type: 'marcher', dir: d.dir })}
            >
              <span aria-hidden="true">{d.fleche}</span>
            </button>
          ))}
        </div>

        <div className="grille-boutons" role="group" aria-label="Boutons">
          <button
            type="button"
            className="grille-bouton grille-b-saluer"
            disabled={disabled}
            onClick={() => void envoyer({ type: 'saluer' })}
          >
            <span aria-hidden="true">👋</span>
            <span className="grille-bouton-nom">Saluer</span>
          </button>
          <button type="button" className="grille-bouton grille-b-action" disabled={disabled} onClick={action}>
            <span aria-hidden="true">✋</span>
            <span className="grille-bouton-nom">Action</span>
          </button>
          <button type="button" className="grille-bouton grille-b-sauter" disabled={disabled} onClick={sauter}>
            <span aria-hidden="true">⤴</span>
            <span className="grille-bouton-nom">Sauter</span>
          </button>
        </div>
      </div>

      {tiroir && (
        <div id={tiroirId} className="grille-tiroir" aria-hidden={!ouvert} inert={!ouvert}>
          {tiroir}
        </div>
      )}
    </section>
  );
}
