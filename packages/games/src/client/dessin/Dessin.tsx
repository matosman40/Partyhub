import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  COULEURS,
  PINCEAUX,
  TAMPONS,
  VUE_INITIALE,
  ajouter,
  annuler,
  epaisseur,
  longueurEncre,
  longueurTrait,
  refaire,
  segmentsLisses,
  tailleTampon,
  toutEffacer,
  versMonde,
  zoomer,
  HISTORIQUE_VIDE,
  type Element,
  type Historique,
  type Mode,
  type Pinceau,
  type Point,
  type TraitLibre,
  type Vue,
} from './modele.js';
import { Icone, type NomIcone } from './icones.js';

/**
 * Outil de dessin réutilisable : pinceaux, couleurs, gomme, tampons, zoom, annuler et refaire.
 *
 * Le dessin reste en vecteurs : `onChange` donne les éléments et la longueur d’encre, dans le repère du dessin,
 * donc un jeu qui demande « trace une ligne de N unités » n’est pas trompé par le zoom.
 * Les options permettent à chaque jeu de ne garder que ce qu’il lui faut.
 */

export type Outil = 'pinceau' | 'gomme' | 'tampon';

export interface DessinOptions {
  /** Pinceaux proposés. Par défaut : tous. */
  pinceaux?: readonly Pinceau[];
  /** Couleurs proposées. Par défaut : la palette. */
  couleurs?: readonly string[];
  /** Tampons proposés. Une liste vide retire l’outil. */
  tampons?: readonly string[];
  /** Gomme (vrai par défaut). */
  gomme?: boolean;
  /** Zoom et déplacement (vrai par défaut). */
  zoom?: boolean;
}

export interface DessinChange {
  elements: Element[];
  /** Longueur d’encre tracée, traits en cours compris, en unités du dessin. */
  longueur: number;
}

export interface DessinProps {
  /** Dimensions logiques du dessin : toutes les mesures se font dans ce repère. */
  largeur?: number;
  hauteur?: number;
  options?: DessinOptions;
  onChange?: (change: DessinChange) => void;
  /** Nom accessible de la zone de dessin. */
  label?: string;
}

interface Reglage {
  outil: Outil;
  pinceau: Pinceau;
  couleur: string;
  taille: number;
  tampon: string;
}

interface Geste {
  vue0: Vue;
  mid0: Point;
  dist0: number;
}

const TAILLE_GRILLE = 40;
const DELAI_CONFIRMATION = 3000;
const ICONE_PINCEAU: Record<Pinceau, NomIcone> = {
  stylo: 'stylo',
  pinceau: 'pinceau',
  marqueur: 'marqueur',
  neon: 'neon',
};

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function milieu(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Coordonnées d’un pointeur dans le repère du dessin, à partir de la position écran de la toile. */
function versLogique(toile: HTMLCanvasElement, x: number, y: number, largeur: number, hauteur: number): Point {
  const r = toile.getBoundingClientRect();
  return { x: ((x - r.left) * largeur) / r.width, y: ((y - r.top) * hauteur) / r.height };
}

/** Dessine un élément, en repère du dessin. La gomme efface ce qui est dessous ; le néon a une lueur. */
function dessinerElement(ctx: CanvasRenderingContext2D, el: Element) {
  if (el.type === 'tampon') {
    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.font = `${tailleTampon(el.taille)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.symbole, 0, 0);
    ctx.restore();
    return;
  }
  dessinerTrait(ctx, el);
}

function dessinerTrait(ctx: CanvasRenderingContext2D, trait: TraitLibre) {
  const reglage = PINCEAUX[trait.pinceau];
  const gomme = trait.mode === 'gomme';
  const points = trait.points;
  if (points.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = gomme ? 'destination-out' : 'source-over';
  ctx.globalAlpha = gomme ? 1 : reglage.opacite;
  ctx.strokeStyle = trait.couleur;
  ctx.lineWidth = epaisseur(trait);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!gomme && reglage.lueur > 0) {
    ctx.shadowColor = trait.couleur;
    ctx.shadowBlur = reglage.lueur;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    // Un simple toucher : un point, rendu comme une tache ronde grâce aux extrémités arrondies.
    ctx.lineTo(points[0].x + 0.01, points[0].y);
  } else {
    for (const { controle, fin } of segmentsLisses(points)) {
      ctx.quadraticCurveTo(controle.x, controle.y, fin.x, fin.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function Dessin({ largeur = 640, hauteur = 400, options, onChange, label = 'Zone de dessin' }: DessinProps) {
  const pinceaux = options?.pinceaux ?? (Object.keys(PINCEAUX) as Pinceau[]);
  const couleurs = options?.couleurs ?? COULEURS;
  const tampons = options?.tampons ?? TAMPONS;
  const gommeActive = options?.gomme !== false;
  const zoomActif = options?.zoom !== false;

  const [historique, setHistorique] = useState<Historique>(HISTORIQUE_VIDE);
  const [vue, setVue] = useState<Vue>(VUE_INITIALE);
  const [reglage, setReglage] = useState<Reglage>({
    outil: 'pinceau',
    pinceau: pinceaux[0] ?? 'stylo',
    couleur: couleurs[0] ?? '#ffffff',
    taille: 8,
    tampon: tampons[0] ?? '',
  });
  const [grille, setGrille] = useState(true);
  const [effacerConfirme, setEffacerConfirme] = useState(false);
  const [echelleAffichage, setEchelleAffichage] = useState(1);

  // Miroirs lus par le dessin : le dessin tourne dans une requête d’image, pas dans le rendu React.
  const historiqueRef = useRef(historique);
  const vueRef = useRef(vue);
  const enCours = useRef<Element | null>(null);
  const pointeurs = useRef(new Map<number, Point>());
  const geste = useRef<Geste | null>(null);
  const planifie = useRef(0);
  const toileRef = useRef<HTMLCanvasElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const curseurRef = useRef<HTMLDivElement>(null);

  const dessiner = () => {
    const toile = toileRef.current;
    const ctx = toile?.getContext('2d');
    if (!toile || !ctx) return;
    const echelle = toile.width / largeur;
    const v = vueRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, toile.width, toile.height);
    ctx.setTransform(echelle * v.echelle, 0, 0, echelle * v.echelle, echelle * v.decalage.x, echelle * v.decalage.y);
    for (const el of historiqueRef.current.elements) dessinerElement(ctx, el);
    if (enCours.current) dessinerElement(ctx, enCours.current);
  };

  const planifier = () => {
    if (planifie.current) return;
    planifie.current = requestAnimationFrame(() => {
      planifie.current = 0;
      dessiner();
    });
  };

  const notifier = (h: Historique, en: Element | null) => {
    const enCoursLongueur = en && en.type === 'libre' && en.mode === 'dessin' ? longueurTrait(en.points) : 0;
    onChange?.({ elements: h.elements, longueur: longueurEncre(h.elements) + enCoursLongueur });
  };

  const appliquer = (h: Historique) => {
    historiqueRef.current = h;
    setHistorique(h);
    notifier(h, enCours.current);
    planifier();
  };

  const appliquerVue = (v: Vue) => {
    vueRef.current = v;
    setVue(v);
    planifier();
  };

  // Taille de la toile : résolution réelle pour les écrans haute densité, plafonnée à 2.
  useEffect(() => {
    const toile = toileRef.current;
    if (!toile) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    toile.width = Math.round(largeur * dpr);
    toile.height = Math.round(hauteur * dpr);
    planifier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [largeur, hauteur]);

  // Échelle d’affichage : pour dimensionner la grille et le curseur en pixels de l’écran.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const mesurer = () => setEchelleAffichage(zone.clientWidth / largeur);
    mesurer();
    if (typeof ResizeObserver === 'undefined') return;
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, [largeur]);

  // Molette : zoom centré sur le pointeur (ordinateur, TV avec souris).
  useEffect(() => {
    const toile = toileRef.current;
    if (!toile || !zoomActif) return;
    const surMolette = (e: WheelEvent) => {
      e.preventDefault();
      const p = versLogique(toile, e.clientX, e.clientY, largeur, hauteur);
      const v = vueRef.current;
      appliquerVue(zoomer(v, v.echelle * Math.exp(-e.deltaY * 0.0015), p, p, largeur, hauteur));
    };
    toile.addEventListener('wheel', surMolette, { passive: false });
    return () => toile.removeEventListener('wheel', surMolette);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomActif, largeur, hauteur]);

  useEffect(
    () => () => {
      if (planifie.current) cancelAnimationFrame(planifie.current);
    },
    [],
  );

  useEffect(() => {
    if (!effacerConfirme) return;
    const minuteur = window.setTimeout(() => setEffacerConfirme(false), DELAI_CONFIRMATION);
    return () => window.clearTimeout(minuteur);
  }, [effacerConfirme]);

  const logique = (e: { clientX: number; clientY: number }): Point => {
    const toile = toileRef.current;
    if (!toile) return { x: 0, y: 0 };
    return versLogique(toile, e.clientX, e.clientY, largeur, hauteur);
  };

  /** Le curseur suit le pointeur : un cercle à l’épaisseur réelle du pinceau, ou le symbole du tampon. */
  const placerCurseur = (e: { clientX: number; clientY: number }) => {
    const curseur = curseurRef.current;
    const toile = toileRef.current;
    if (!curseur || !toile) return;
    const r = toile.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const echelle = (r.width / largeur) * vueRef.current.echelle;
    const facteur = reglage.outil === 'gomme' ? PINCEAUX.pinceau.facteur : PINCEAUX[reglage.pinceau].facteur;
    const diametre =
      reglage.outil === 'tampon' ? tailleTampon(reglage.taille) * echelle : reglage.taille * facteur * echelle;
    // Le curseur est centré sur le pointeur.
    curseur.style.transform = `translate(${x - diametre / 2}px, ${y - diametre / 2}px)`;
    curseur.style.width = `${diametre}px`;
    curseur.style.height = `${diametre}px`;
    curseur.style.fontSize = `${diametre}px`;
    curseur.dataset.actif = '1';
  };

  const surBas = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = logique(e);
    pointeurs.current.set(e.pointerId, p);

    if (pointeurs.current.size === 2) {
      // Un second doigt : c’est un geste de zoom, le trait en cours est abandonné.
      enCours.current = null;
      if (!zoomActif) return;
      const [a, b] = [...pointeurs.current.values()];
      geste.current = { vue0: vueRef.current, mid0: milieu(a, b), dist0: distance(a, b) };
      planifier();
      return;
    }
    if (pointeurs.current.size > 1) return;

    const m = versMonde(vueRef.current, p);
    if (reglage.outil === 'tampon') {
      enCours.current = {
        type: 'tampon',
        symbole: reglage.tampon,
        x: m.x,
        y: m.y,
        taille: reglage.taille,
        rotation: Math.round((Math.random() * 2 - 1) * 20),
      };
    } else {
      const mode: Mode = reglage.outil === 'gomme' ? 'gomme' : 'dessin';
      enCours.current = {
        type: 'libre',
        mode,
        pinceau: reglage.outil === 'gomme' ? 'pinceau' : reglage.pinceau,
        couleur: reglage.couleur,
        taille: reglage.taille,
        points: [m],
      };
    }
    planifier();
  };

  const surDeplacement = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = logique(e);
    if (!pointeurs.current.has(e.pointerId)) {
      placerCurseur(e);
      return;
    }
    pointeurs.current.set(e.pointerId, p);

    const g = geste.current;
    if (g && pointeurs.current.size === 2) {
      const [a, b] = [...pointeurs.current.values()];
      const echelle = g.vue0.echelle * (distance(a, b) / g.dist0);
      appliquerVue(zoomer(g.vue0, echelle, g.mid0, milieu(a, b), largeur, hauteur));
      return;
    }

    const en = enCours.current;
    if (en && en.type === 'libre' && pointeurs.current.size === 1) {
      const m = versMonde(vueRef.current, p);
      const dernier = en.points[en.points.length - 1];
      // Un mouvement sous le dixième de pixel ne sert à rien et alourdit le tracé.
      if (distance(dernier, m) >= 0.1 / vueRef.current.echelle) {
        en.points.push(m);
        notifier(historiqueRef.current, en);
        planifier();
      }
    }
    placerCurseur(e);
  };

  const surFin = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointeurs.current.delete(e.pointerId);
    if (pointeurs.current.size === 0) {
      const en = enCours.current;
      enCours.current = null;
      geste.current = null;
      if (en) appliquer(ajouter(historiqueRef.current, en));
    } else if (pointeurs.current.size === 1) {
      geste.current = null;
    }
    planifier();
  };

  const centre = { x: largeur / 2, y: hauteur / 2 };
  const zoomerDe = (facteur: number) => {
    const v = vueRef.current;
    appliquerVue(zoomer(v, v.echelle * facteur, centre, centre, largeur, hauteur));
  };
  const toutEffacerAvecConfirmation = () => {
    if (!effacerConfirme) {
      setEffacerConfirme(true);
      return;
    }
    setEffacerConfirme(false);
    appliquer(toutEffacer());
  };

  const pourcentage = Math.round(vue.echelle * 100);
  const cote = TAILLE_GRILLE * vue.echelle * echelleAffichage;
  const styleGrille = grille
    ? {
        backgroundSize: `${cote}px ${cote}px`,
        backgroundPosition: `${vue.decalage.x * echelleAffichage}px ${vue.decalage.y * echelleAffichage}px`,
      }
    : undefined;

  return (
    <div className="dessin">
      <div className="dessin-barre" role="toolbar" aria-label="Outils de dessin">
        <div className="dessin-ligne">
          <button
            type="button"
            className="dessin-bouton"
            onClick={() => appliquer(annuler(historique))}
            disabled={historique.elements.length === 0}
            aria-label="Annuler"
            title="Annuler"
          >
            <Icone nom="annuler" />
          </button>
          <button
            type="button"
            className="dessin-bouton"
            onClick={() => appliquer(refaire(historique))}
            disabled={historique.refaits.length === 0}
            aria-label="Refaire"
            title="Refaire"
          >
            <Icone nom="refaire" />
          </button>
          <span className="dessin-separateur" aria-hidden="true" />
          <button
            type="button"
            className={`dessin-bouton${grille ? ' is-actif' : ''}`}
            aria-pressed={grille}
            aria-label="Grille"
            title="Grille"
            onClick={() => setGrille((g) => !g)}
          >
            <Icone nom="grille" />
          </button>
          <button
            type="button"
            className={`dessin-bouton dessin-bouton-effacer${effacerConfirme ? ' is-confirme' : ''}`}
            onClick={toutEffacerAvecConfirmation}
            disabled={historique.elements.length === 0 && !effacerConfirme}
            aria-label={effacerConfirme ? 'Confirmer : tout effacer' : 'Tout effacer'}
            title={effacerConfirme ? 'Appuyez encore pour tout effacer' : 'Tout effacer'}
          >
            <Icone nom="corbeille" />
            {effacerConfirme && <span className="dessin-confirme">Confirmer ?</span>}
          </button>
        </div>

        {zoomActif && (
          <div className="dessin-ligne">
            <div className="dessin-groupe" role="group" aria-label="Zoom">
              <button
                type="button"
                className="dessin-bouton"
                onClick={() => zoomerDe(1 / 1.25)}
                aria-label="Dézoomer"
                title="Dézoomer"
                disabled={vue.echelle <= 1}
              >
                <Icone nom="zoomMoins" />
              </button>
              <output className="dessin-pourcentage" aria-live="polite">
                {pourcentage} %
              </output>
              <button
                type="button"
                className="dessin-bouton"
                onClick={() => zoomerDe(1.25)}
                aria-label="Zoomer"
                title="Zoomer"
                disabled={vue.echelle >= 5}
              >
                <Icone nom="zoomPlus" />
              </button>
              <button
                type="button"
                className="dessin-bouton"
                onClick={() => appliquerVue(VUE_INITIALE)}
                aria-label="Taille d’origine"
                title="Taille d’origine"
                disabled={vue.echelle === 1}
              >
                <Icone nom="ajuster" />
              </button>
            </div>
          </div>
        )}

        <div className="dessin-ligne">
          <div className="dessin-groupe" role="group" aria-label="Pinceaux">
            {pinceaux.map((p) => {
              const actif = reglage.outil === 'pinceau' && reglage.pinceau === p;
              return (
                <button
                  key={p}
                  type="button"
                  className={`dessin-bouton${actif ? ' is-actif' : ''}`}
                  aria-pressed={actif}
                  aria-label={PINCEAUX[p].libelle}
                  title={PINCEAUX[p].libelle}
                  onClick={() => setReglage((r) => ({ ...r, outil: 'pinceau', pinceau: p }))}
                >
                  <Icone nom={ICONE_PINCEAU[p]} />
                </button>
              );
            })}
          </div>
          {(gommeActive || tampons.length > 0) && <span className="dessin-separateur" aria-hidden="true" />}
          <div className="dessin-groupe" role="group" aria-label="Autres outils">
            {gommeActive && (
              <button
                type="button"
                className={`dessin-bouton${reglage.outil === 'gomme' ? ' is-actif' : ''}`}
                aria-pressed={reglage.outil === 'gomme'}
                aria-label="Gomme"
                title="Gomme"
                onClick={() => setReglage((r) => ({ ...r, outil: 'gomme' }))}
              >
                <Icone nom="gomme" />
              </button>
            )}
            {tampons.length > 0 && (
              <button
                type="button"
                className={`dessin-bouton${reglage.outil === 'tampon' ? ' is-actif' : ''}`}
                aria-pressed={reglage.outil === 'tampon'}
                aria-label="Tampons"
                title="Tampons"
                onClick={() => setReglage((r) => ({ ...r, outil: 'tampon', tampon: r.tampon || tampons[0] }))}
              >
                <Icone nom="tampon" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="dessin-reglages">
        {reglage.outil === 'pinceau' && (
          <div className="dessin-couleurs" role="group" aria-label="Couleurs">
            {couleurs.map((c) => (
              <button
                key={c}
                type="button"
                className={`dessin-couleur${reglage.couleur === c ? ' is-actif' : ''}`}
                style={{ background: c }}
                aria-pressed={reglage.couleur === c}
                aria-label={`Couleur ${c}`}
                title={c}
                onClick={() => setReglage((r) => ({ ...r, couleur: c }))}
              />
            ))}
            <label className="dessin-couleur-libre" title="Autre couleur">
              <span className="sr-only">Autre couleur</span>
              <input
                type="color"
                value={reglage.couleur}
                onChange={(e) => setReglage((r) => ({ ...r, couleur: e.target.value }))}
              />
            </label>
          </div>
        )}
        {reglage.outil === 'tampon' && (
          <div className="dessin-tampons" role="group" aria-label="Tampons">
            {tampons.map((t) => (
              <button
                key={t}
                type="button"
                className={`dessin-tampon${reglage.tampon === t ? ' is-actif' : ''}`}
                aria-pressed={reglage.tampon === t}
                aria-label={`Tampon ${t}`}
                onClick={() => setReglage((r) => ({ ...r, tampon: t }))}
              >
                <span aria-hidden="true">{t}</span>
              </button>
            ))}
          </div>
        )}
        <label className="dessin-taille">
          <span>{reglage.outil === 'gomme' ? 'Gomme' : 'Taille'}</span>
          <input
            type="range"
            min={2}
            max={40}
            step={1}
            value={reglage.taille}
            onChange={(e) => setReglage((r) => ({ ...r, taille: Number(e.target.value) }))}
            aria-label="Taille du pinceau"
          />
          <output>{reglage.taille}</output>
        </label>
      </div>

      <div ref={zoneRef} className={`dessin-zone${grille ? ' is-grille' : ''}`} style={styleGrille}>
        <canvas
          ref={toileRef}
          className="dessin-toile"
          role="img"
          aria-label={label}
          style={{ aspectRatio: `${largeur} / ${hauteur}`, touchAction: 'none' }}
          onPointerDown={surBas}
          onPointerMove={surDeplacement}
          onPointerUp={surFin}
          onPointerCancel={surFin}
          onPointerLeave={() => {
            // Le curseur disparaît quand le doigt ou la souris quitte la toile.
            if (curseurRef.current) curseurRef.current.dataset.actif = '0';
          }}
          onPointerEnter={() => {
            if (curseurRef.current) curseurRef.current.dataset.actif = '1';
          }}
        />
        <div
          ref={curseurRef}
          className={`dessin-curseur${reglage.outil === 'tampon' ? ' is-tampon' : ''}`}
          data-actif="0"
          aria-hidden="true"
        >
          {reglage.outil === 'tampon' ? reglage.tampon : null}
        </div>
      </div>
    </div>
  );
}
