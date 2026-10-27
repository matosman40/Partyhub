import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { requestCamera, readMediaPrefs } from '../../client/media.js';
import {
  requestMotionAccess,
  useMicLevel,
  useMotionFeed,
  type MotionAccess,
  type MotionFrame,
} from '../../client/sensors.js';
import { HoldTimer } from '../../client/sensors-core.js';

/**
 * Les quatre essais, côté téléphone. Chacun appelle `onDone(reussi)` une seule fois, quand l’essai réussit
 * ou quand le joueur abandonne. Les seuils viennent de l’hôte (vue publique), pour que la règle soit la même partout.
 */

export interface Reglages {
  /** Durée du son à tenir, en millisecondes. */
  dureeSon: number;
  /** Longueur de trait à tracer, en pixels du dessin. */
  longueurTrait: number;
  /** Inclinaison à atteindre de chaque côté, en pourcentage de l’inclinaison maximale. */
  inclinaison: number;
  reprise: boolean;
}

export interface EssaiProps {
  onDone: (reussi: boolean) => void;
  reglages: Reglages;
}

/** Niveau du micro à partir duquel on entend un son (de 0 à 1). */
const MIC_LEVEL = 0.2;
/** Largeur du dessin, en pixels (le canevas garde ce repère). */
const LARGEUR_DESSIN = 640;
const HAUTEUR_DESSIN = 400;

/** Anneau de progression autour d’une pastille : `progres` de 0 à 1. */
function Pastille({
  icone,
  progres = 0,
  tons = 'neutre',
}: {
  icone: string;
  progres?: number;
  tons?: 'neutre' | 'ok';
}) {
  return (
    <div
      className={`essai-orbe is-${tons}`}
      style={{ ['--p' as string]: `${Math.round(Math.max(0, Math.min(1, progres)) * 360)}deg` }}
      aria-hidden="true"
    >
      <span>{icone}</span>
    </div>
  );
}

/** Message quand un capteur ou un appareil n’est pas utilisable, avec une sortie pour ne pas bloquer le bilan. */
function Impossible({ texte, onPasser }: { texte: string; onPasser: () => void }) {
  return (
    <div className="essai-bloc">
      <p className="essai-note" role="alert">
        {texte}
      </p>
      <button type="button" className="btn big" onClick={onPasser}>
        Ce n’est pas possible sur mon téléphone
      </button>
    </div>
  );
}

/** Micro : maintenir un son pendant la durée réglée. */
export function MicroEssai({ onDone, reglages }: EssaiProps) {
  const [actif, setActif] = useState(false);
  const { status, level } = useMicLevel(actif);
  const [hold] = useState(() => new HoldTimer());
  const [tenu, setTenu] = useState(0);
  const fini = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (status !== 'ready' || fini.current) return;
    const duree = hold.feed(level >= MIC_LEVEL, performance.now());
    setTenu(duree);
    if (duree >= reglages.dureeSon) {
      fini.current = true;
      onDoneRef.current(true);
    }
  }, [level, status, hold, reglages.dureeSon]);

  if (!actif) {
    return (
      <div className="essai-bloc">
        <Pastille icone="🎤" />
        <p className="essai-texte">Autorisez le micro, puis dites « ah » ou soufflez.</p>
        <button type="button" className="btn primary big" onClick={() => setActif(true)}>
          Démarrer le micro
        </button>
      </div>
    );
  }
  if (status === 'denied' || status === 'unavailable' || status === 'insecure') {
    const texte =
      status === 'insecure'
        ? 'Le micro est bloqué : la page n’est pas en HTTPS.'
        : status === 'denied'
          ? 'Le micro est refusé : autorisez-le dans le navigateur.'
          : 'Ce téléphone ne donne pas accès au micro.';
    return <Impossible texte={texte} onPasser={() => onDone(false)} />;
  }

  const barres = Array.from({ length: 9 }, (_, i) => level >= (i + 1) / 10);
  return (
    <div className="essai-bloc">
      <Pastille icone="🎤" progres={tenu / reglages.dureeSon} />
      <div className="essai-barres" role="img" aria-label="Niveau du micro">
        {barres.map((allume, i) => (
          <span key={i} className={allume ? 'is-on' : undefined} style={{ height: `${28 + i * 8}%` }} />
        ))}
      </div>
      <p className="essai-texte" aria-live="polite">
        {status === 'starting'
          ? 'Micro en cours…'
          : `Maintenez le son : ${(tenu / 1000).toFixed(1)} s / ${(reglages.dureeSon / 1000).toFixed(1)} s`}
      </p>
      <button type="button" className="btn ghost" onClick={() => onDone(false)}>
        Je n’entends rien
      </button>
    </div>
  );
}

/** Caméra : démarrer l’image, puis confirmer qu’on se voit. */
export function CameraEssai({ onDone }: EssaiProps) {
  const [actif, setActif] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [image, setImage] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!actif) return;
    let annule = false;
    let flux: MediaStream | null = null;
    requestCamera(readMediaPrefs(), 'user')
      .then((stream) => {
        if (annule) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        flux = stream;
        if (video.current) {
          video.current.srcObject = stream;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch(() => {
        if (!annule) setErreur('La caméra est refusée ou absente : autorisez-la dans le navigateur.');
      });
    return () => {
      annule = true;
      flux?.getTracks().forEach((t) => t.stop());
    };
  }, [actif]);

  if (erreur) return <Impossible texte={erreur} onPasser={() => onDone(false)} />;
  if (!actif) {
    return (
      <div className="essai-bloc">
        <Pastille icone="📷" />
        <p className="essai-texte">Votre image s’affiche ici, en miroir. Vous devez vous voir pour valider.</p>
        <button type="button" className="btn primary big" onClick={() => setActif(true)}>
          Démarrer la caméra
        </button>
      </div>
    );
  }
  return (
    <div className="essai-bloc">
      <div className="essai-cam">
        <video
          ref={video}
          muted
          playsInline
          autoPlay
          aria-label="Image de la caméra"
          onPlaying={(e) => setImage(e.currentTarget.videoWidth > 0)}
        />
        <span className="essai-cam-guide" aria-hidden="true" />
      </div>
      <p className="essai-texte" aria-live="polite">
        {image ? 'Image reçue : vous vous voyez ?' : 'Démarrage de la caméra…'}
      </p>
      <div className="essai-actions">
        <button type="button" className="btn primary big" disabled={!image} onClick={() => onDone(true)}>
          Je me vois
        </button>
        <button type="button" className="btn ghost" onClick={() => onDone(false)}>
          Je ne me vois pas
        </button>
      </div>
    </div>
  );
}

/** Mouvement : pencher le téléphone d’un côté, puis de l’autre. L’icône suit l’inclinaison en direct. */
export function MouvementEssai({ onDone, reglages }: EssaiProps) {
  const [acces, setAcces] = useState<MotionAccess | null>(null);
  const [actif, setActif] = useState(false);
  const [inclinaison, setInclinaison] = useState(0);
  const [premierCote, setPremierCote] = useState(false);
  const [autreCote, setAutreCote] = useState(false);
  const vus = useRef({ premier: false, autre: false, sens: 0 });
  const fini = useRef(false);
  const onDoneRef = useRef(onDone);
  const seuil = reglages.inclinaison / 100;

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const { signal } = useMotionFeed(actif, (frame: MotionFrame) => {
    if (fini.current) return;
    const x = frame.tilt.x;
    setInclinaison((prev) => (Math.abs(prev - x) > 0.03 ? x : prev));
    // Le premier côté franchi sert de référence : il faut ensuite aller de l’autre côté.
    if (vus.current.sens === 0) {
      if (Math.abs(x) >= seuil) {
        vus.current.sens = Math.sign(x);
        vus.current.premier = true;
        setPremierCote(true);
      }
    } else if (Math.sign(x) === -vus.current.sens && Math.abs(x) >= seuil && !vus.current.autre) {
      vus.current.autre = true;
      setAutreCote(true);
    }
    if (vus.current.premier && vus.current.autre) {
      fini.current = true;
      onDoneRef.current(true);
    }
  });

  async function demarrer() {
    const r = await requestMotionAccess();
    setAcces(r);
    if (r === 'granted') setActif(true);
  }

  if (!actif) {
    if (acces && acces !== 'granted') {
      const texte =
        acces === 'insecure'
          ? 'Le mouvement est bloqué : la page n’est pas en HTTPS.'
          : acces === 'denied'
            ? 'Le mouvement est refusé : autorisez-le dans le navigateur ou les réglages du téléphone.'
            : 'Ce téléphone ne donne pas accès au mouvement.';
      return <Impossible texte={texte} onPasser={() => onDone(false)} />;
    }
    return (
      <div className="essai-bloc">
        <Pastille icone="🧭" />
        <p className="essai-texte">Posez le téléphone à plat, puis démarrez.</p>
        <button type="button" className="btn primary big" onClick={() => void demarrer()}>
          Démarrer le mouvement
        </button>
      </div>
    );
  }
  if (signal === 'no') {
    return <Impossible texte="Ce téléphone ne transmet pas le mouvement." onPasser={() => onDone(false)} />;
  }
  return (
    <div className="essai-bloc">
      <div
        className="essai-boussole"
        style={{ transform: `rotate(${Math.round(inclinaison * 40)}deg)` }}
        aria-hidden="true"
      >
        🧭
      </div>
      <ul className="essai-chips" aria-label="Progression du mouvement">
        <li className={premierCote ? 'is-ok' : undefined}>{premierCote ? '✔' : '○'} Penchez d’un côté</li>
        <li className={autreCote ? 'is-ok' : undefined}>{autreCote ? '✔' : '○'} Puis de l’autre</li>
      </ul>
      <button type="button" className="btn ghost" onClick={() => onDone(false)}>
        Je n’y arrive pas
      </button>
    </div>
  );
}

/** Dessin : tracer un trait sur l’écran, sur la longueur réglée par l’hôte, puis valider. */
export function DessinEssai({ onDone, reglages }: EssaiProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dessine = useRef(false);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const longueur = useRef(0);
  const [progres, setProgres] = useState(0);

  function point(e: ReactPointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  }

  function debut(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dessine.current = true;
    dernier.current = point(e);
  }

  function deplace(e: ReactPointerEvent<HTMLCanvasElement>) {
    const c = canvas.current;
    const avant = dernier.current;
    if (!dessine.current || !avant || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.strokeStyle = '#3ff5e0';
    ctx.shadowColor = 'rgba(63, 245, 224, 0.7)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(avant.x, avant.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    longueur.current += Math.hypot(p.x - avant.x, p.y - avant.y);
    dernier.current = p;
    setProgres(Math.min(1, longueur.current / reglages.longueurTrait));
  }

  function fin() {
    dessine.current = false;
    dernier.current = null;
  }

  function effacer() {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    longueur.current = 0;
    setProgres(0);
  }

  const pret = progres >= 1;
  return (
    <div className="essai-bloc">
      <div className="essai-pad">
        <canvas
          ref={canvas}
          width={LARGEUR_DESSIN}
          height={HAUTEUR_DESSIN}
          aria-label="Zone de dessin"
          onPointerDown={debut}
          onPointerMove={deplace}
          onPointerUp={fin}
          onPointerCancel={fin}
          onPointerLeave={fin}
        />
        {progres === 0 && <span className="essai-pad-indice">Glissez le doigt ici</span>}
      </div>
      <div
        className="essai-progress"
        role="progressbar"
        aria-label="Longueur du trait"
        aria-valuenow={Math.round(progres * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${Math.round(progres * 100)}%` }} />
      </div>
      <div className="essai-actions">
        <button type="button" className="btn primary big" disabled={!pret} onClick={() => onDone(true)}>
          Le dessin marche
        </button>
        <button type="button" className="btn ghost" onClick={effacer}>
          Effacer
        </button>
      </div>
      <button type="button" className="btn ghost small" onClick={() => onDone(false)}>
        Je n’arrive pas à dessiner
      </button>
    </div>
  );
}
