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
 * ou quand le joueur abandonne. Rien n’est envoyé au serveur sauf ce résultat.
 */

export interface EssaiProps {
  onDone: (reussi: boolean) => void;
}

/** Niveau du micro à partir duquel on considère qu’on entend un son (de 0 à 1). */
const MIC_LEVEL = 0.2;
/** Durée pendant laquelle le son doit être entendu pour réussir l’essai du micro. */
const MIC_HOLD_MS = 1000;
/** Inclinaison, relative à la pose de départ, à partir de laquelle on compte un côté (de 0 à 1). */
const INCLINAISON = 0.5;
/** Longueur de trait, en pixels du dessin, à partir de laquelle l’essai du dessin est réussi. */
const TRAIT_MIN = 150;

/** Message quand un capteur ou un appareil n’est pas utilisable, avec une sortie pour ne pas bloquer le bilan. */
function Impossible({ texte, onPasser }: { texte: string; onPasser: () => void }) {
  return (
    <>
      <p className="notice" role="alert">
        {texte}
      </p>
      <button type="button" className="btn big" onClick={onPasser}>
        Ce n’est pas possible sur mon téléphone
      </button>
    </>
  );
}

/** Micro : maintenir un son pendant une seconde. */
export function MicroEssai({ onDone }: EssaiProps) {
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
    if (duree >= MIC_HOLD_MS) {
      fini.current = true;
      onDoneRef.current(true);
    }
  }, [level, status, hold]);

  if (!actif) {
    return (
      <button type="button" className="btn primary big" onClick={() => setActif(true)}>
        Démarrer le micro
      </button>
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
  return (
    <div>
      <div
        role="img"
        aria-label="Niveau du micro"
        style={{ height: 18, borderRadius: 9, background: 'rgba(0,0,0,0.15)', overflow: 'hidden' }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`,
            background: 'currentColor',
          }}
        />
      </div>
      <p className="notice" aria-live="polite">
        {status === 'starting' ? 'Micro en cours…' : `Dites « ah » ou soufflez : ${(tenu / 1000).toFixed(1)} s / 1,0 s`}
      </p>
      <button type="button" className="btn big" onClick={() => onDone(false)}>
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
      <button type="button" className="btn primary big" onClick={() => setActif(true)}>
        Démarrer la caméra
      </button>
    );
  }
  return (
    <div>
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        aria-label="Image de la caméra"
        onPlaying={(e) => setImage(e.currentTarget.videoWidth > 0)}
        style={{ width: '100%', borderRadius: 12, transform: 'scaleX(-1)', background: '#000' }}
      />
      <p className="notice" aria-live="polite">
        {image ? 'Image reçue. Vous vous voyez ?' : 'Démarrage de la caméra…'}
      </p>
      <button type="button" className="btn primary big" disabled={!image} onClick={() => onDone(true)}>
        Je me vois
      </button>
      <button type="button" className="btn big" onClick={() => onDone(false)}>
        Je ne me vois pas
      </button>
    </div>
  );
}

/** Mouvement : pencher le téléphone d’un côté, puis de l’autre. */
export function MouvementEssai({ onDone }: EssaiProps) {
  const [acces, setAcces] = useState<MotionAccess | null>(null);
  const [actif, setActif] = useState(false);
  const [premierCote, setPremierCote] = useState(false);
  const [autreCote, setAutreCote] = useState(false);
  const vus = useRef({ premier: false, autre: false, sens: 0 });
  const fini = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const { signal } = useMotionFeed(actif, (frame: MotionFrame) => {
    if (fini.current) return;
    const x = frame.tilt.x;
    // Le premier côté franchi sert de référence : il faut ensuite aller de l’autre côté.
    if (vus.current.sens === 0) {
      if (Math.abs(x) >= INCLINAISON) {
        vus.current.sens = Math.sign(x);
        vus.current.premier = true;
        setPremierCote(true);
      }
    } else if (Math.sign(x) === -vus.current.sens && Math.abs(x) >= INCLINAISON && !vus.current.autre) {
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
      <button type="button" className="btn primary big" onClick={() => void demarrer()}>
        Démarrer le mouvement
      </button>
    );
  }
  if (signal === 'no') {
    return <Impossible texte="Ce téléphone ne transmet pas le mouvement." onPasser={() => onDone(false)} />;
  }
  return (
    <div>
      <p className="notice" aria-live="polite">
        {premierCote ? '✔' : '…'} Penchez le téléphone d’un côté
      </p>
      <p className="notice" aria-live="polite">
        {autreCote ? '✔' : '…'} Puis penchez-le de l’autre côté
      </p>
      <button type="button" className="btn big" onClick={() => onDone(false)}>
        Je n’y arrive pas
      </button>
    </div>
  );
}

/** Dessin : tracer un trait sur l’écran, puis valider. */
export function DessinEssai({ onDone }: EssaiProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dessine = useRef(false);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const longueur = useRef(0);
  const [assez, setAssez] = useState(false);

  function point(e: ReactPointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
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
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(avant.x, avant.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    longueur.current += Math.hypot(p.x - avant.x, p.y - avant.y);
    dernier.current = p;
    if (!assez && longueur.current >= TRAIT_MIN) setAssez(true);
  }

  function fin() {
    dessine.current = false;
    dernier.current = null;
  }

  function effacer() {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    longueur.current = 0;
    setAssez(false);
  }

  return (
    <div>
      <canvas
        ref={canvas}
        width={640}
        height={400}
        aria-label="Zone de dessin"
        onPointerDown={debut}
        onPointerMove={deplace}
        onPointerUp={fin}
        onPointerCancel={fin}
        onPointerLeave={fin}
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: '640 / 400',
          touchAction: 'none',
          background: '#fff',
          borderRadius: 12,
        }}
      />
      <p className="notice" aria-live="polite">
        {assez ? 'Trait bien tracé.' : 'Tracez un trait sur la zone blanche.'}
      </p>
      <button type="button" className="btn primary big" disabled={!assez} onClick={() => onDone(true)}>
        Le dessin marche
      </button>
      <button type="button" className="btn" onClick={effacer}>
        Effacer
      </button>
      <button type="button" className="btn big" onClick={() => onDone(false)}>
        Je n’arrive pas à dessiner
      </button>
    </div>
  );
}
