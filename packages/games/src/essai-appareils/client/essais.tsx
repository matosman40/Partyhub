import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  /** Caméra : enregistrer deux secondes de vidéo et la relire. */
  enregistrement: boolean;
  /** Caméra : images par seconde minimum. */
  imagesMin: number;
  /** Touches : délai maximal (médiane) entre le toucher et le retour, en millisecondes. */
  seuilTouche: number;
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

/** Durée de l’enregistrement de test, en millisecondes. */
const DUREE_ENREGISTREMENT = 2000;
/** Durée de la mesure de fluidité, en millisecondes. */
const DUREE_FLUIDITE = 1500;

/** Types de vidéo essayés, du plus courant au plus large. Le premier pris en charge par le téléphone est utilisé. */
const TYPES_VIDEO = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

type VideoAvecFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Caméra : l’image doit arriver, la vidéo doit être fluide (images par seconde mesurées sur le téléphone), et
 * l’enregistrement de deux secondes doit se relire. Rien ne quitte le téléphone : c’est un test local.
 */
export function CameraEssai({ onDone, reglages }: EssaiProps) {
  const [actif, setActif] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [image, setImage] = useState(false);
  const [mesure, setMesure] = useState<'attente' | 'en-cours' | 'finie' | 'inconnue'>('attente');
  const [fps, setFps] = useState<number | null>(null);
  const [enregistrement, setEnregistrement] = useState<'aucun' | 'en-cours' | 'relisible' | 'illisible'>('aucun');
  const [clip, setClip] = useState<string | null>(null);
  const video = useRef<VideoAvecFrames>(null);
  const flux = useRef<MediaStream | null>(null);
  const enregistreur = useRef<MediaRecorder | null>(null);
  const urlClip = useRef<string | null>(null);

  // Démarrage et arrêt propre : les pistes et l’enregistrement cessent à la fermeture de l’essai.
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    requestCamera(readMediaPrefs(), 'user')
      .then((stream) => {
        if (annule) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        flux.current = stream;
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
      flux.current?.getTracks().forEach((t) => t.stop());
      flux.current = null;
      if (enregistreur.current?.state === 'recording') enregistreur.current.stop();
    };
  }, [actif]);

  // Libère l’adresse de l’enregistrement quand l’essai se ferme.
  useEffect(() => {
    return () => {
      if (urlClip.current) URL.revokeObjectURL(urlClip.current);
    };
  }, []);

  // Fluidité : on compte les images réellement affichées pendant une courte mesure, une seule fois.
  useEffect(() => {
    const v = video.current;
    if (!image || !v) return;
    if (typeof v.requestVideoFrameCallback !== 'function') {
      setMesure('inconnue');
      return;
    }
    setMesure('en-cours');
    let images = 0;
    let debut: number | null = null;
    let id = 0;
    let stop = false;
    const tick = (now: number) => {
      if (stop) return;
      if (debut === null) debut = now;
      images += 1;
      if (now - debut >= DUREE_FLUIDITE) {
        setFps(Math.round((images * 1000) / (now - debut)));
        setMesure('finie');
        return;
      }
      id = v.requestVideoFrameCallback?.(tick) ?? 0;
    };
    id = v.requestVideoFrameCallback(tick);
    return () => {
      stop = true;
      v.cancelVideoFrameCallback?.(id);
    };
  }, [image]);

  function enregistrer() {
    const stream = flux.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setEnregistrement('illisible');
      return;
    }
    const type = TYPES_VIDEO.find((t) => MediaRecorder.isTypeSupported?.(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      setEnregistrement('illisible');
      return;
    }
    const morceaux: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) morceaux.push(e.data);
    };
    rec.onstop = () => {
      if (urlClip.current) URL.revokeObjectURL(urlClip.current);
      const url = URL.createObjectURL(new Blob(morceaux, { type: rec.mimeType || 'video/webm' }));
      urlClip.current = url;
      setClip(url);
      setEnregistrement('relisible');
    };
    enregistreur.current = rec;
    setEnregistrement('en-cours');
    rec.start();
    window.setTimeout(() => {
      if (rec.state === 'recording') rec.stop();
    }, DUREE_ENREGISTREMENT);
  }

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

  const mesureFaite = mesure === 'finie' || mesure === 'inconnue';
  const fluide = mesure === 'inconnue' || (mesure === 'finie' && (fps ?? 0) >= reglages.imagesMin);
  const relu = !reglages.enregistrement || enregistrement === 'relisible';
  const pret = image && mesureFaite && fluide && relu;
  let consigne = 'Démarrage de la caméra…';
  if (image && mesure === 'en-cours') consigne = 'Image reçue. Mesure de la fluidité…';
  if (image && mesure === 'inconnue') consigne = 'Image reçue : vous vous voyez ?';
  if (image && mesure === 'finie') {
    consigne = fluide ? `Vidéo fluide : ${fps} images/s. Vous vous voyez ?` : `Vidéo saccadée : ${fps} images/s.`;
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
        {consigne}
      </p>

      {reglages.enregistrement && image && (
        <div className="essai-clip">
          {enregistrement === 'aucun' && (
            <button type="button" className="btn ghost small" onClick={enregistrer}>
              Enregistrer 2 s pour vérifier la vidéo
            </button>
          )}
          {enregistrement === 'en-cours' && <p className="essai-texte">Enregistrement en cours…</p>}
          {enregistrement === 'relisible' && clip && (
            <>
              <video className="essai-clip-video" src={clip} controls playsInline aria-label="Enregistrement de test" />
              <p className="essai-texte">Votre enregistrement se relit : la vidéo est bien enregistrée.</p>
            </>
          )}
          {enregistrement === 'illisible' && (
            <p className="essai-note" role="alert">
              Ce téléphone n’enregistre pas la vidéo dans le navigateur.
            </p>
          )}
        </div>
      )}

      {mesureFaite && !fluide && (
        <p className="essai-note" role="alert">
          Moins de {reglages.imagesMin} images par seconde : rapprochez-vous de la lumière ou fermez les autres applis.
        </p>
      )}

      <div className="essai-actions">
        <button type="button" className="btn primary big" disabled={!pret} onClick={() => onDone(true)}>
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

/** Nombre de touches de la mesure. */
const TOUCHES_MESURE = 5;
/** Positions possibles de la cible, en pourcentage de la zone : une grille de 3 × 3. */
const POSITIONS = [15, 50, 85];

function nouvellePosition(actuelle: { x: number; y: number }): { x: number; y: number } {
  const choix: { x: number; y: number }[] = [];
  for (const x of POSITIONS) {
    for (const y of POSITIONS) {
      if (x !== actuelle.x || y !== actuelle.y) choix.push({ x, y });
    }
  }
  return choix[Math.floor(Math.random() * choix.length)];
}

/** Médiane d’une liste de mesures, en millisecondes. */
export function mediane(valeurs: number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2;
}

/**
 * Touches : la cible change de place à chaque toucher. Le délai mesuré va du toucher (horodatage de l’événement)
 * à l’image suivante affichée : c’est le temps de réponse du téléphone et du navigateur. Le verdict porte sur la
 * médiane des cinq mesures, comparée au seuil réglé par l’hôte.
 */
export function ToucheEssai({ onDone, reglages }: EssaiProps) {
  const [cible, setCible] = useState({ x: 50, y: 50 });
  const [mesures, setMesures] = useState<number[]>([]);
  const debut = useRef<number | null>(null);
  const fini = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // Après chaque toucher, la mesure se termine à la première image qui suit le changement de place.
  useLayoutEffect(() => {
    const t0 = debut.current;
    if (t0 === null) return;
    debut.current = null;
    requestAnimationFrame(() => {
      const ms = performance.now() - t0;
      setMesures((prev) => [...prev, ms]);
    });
  }, [cible]);

  useEffect(() => {
    if (fini.current || mesures.length < TOUCHES_MESURE) return;
    fini.current = true;
    onDoneRef.current(mediane(mesures) <= reglages.seuilTouche);
  }, [mesures, reglages.seuilTouche]);

  function toucher(e: ReactPointerEvent<HTMLButtonElement>) {
    if (fini.current || debut.current !== null) return;
    debut.current = e.timeStamp;
    setCible((actuelle) => nouvellePosition(actuelle));
  }

  const faites = mesures.length;
  const derniere = faites > 0 ? Math.round(mesures[faites - 1]) : null;
  const median = faites > 0 ? Math.round(mediane(mesures)) : null;
  return (
    <div className="essai-bloc">
      <div className="essai-zone-touche">
        <button
          type="button"
          className="essai-cible"
          style={{ left: `${cible.x}%`, top: `${cible.y}%` }}
          onPointerDown={toucher}
          aria-label="Touchez la cible"
        >
          <span aria-hidden="true">👆</span>
        </button>
      </div>
      <p className="essai-texte" aria-live="polite">
        {faites < TOUCHES_MESURE
          ? `Touche ${faites + 1} sur ${TOUCHES_MESURE} : touchez la cible dès qu’elle bouge.`
          : 'Mesure terminée.'}
      </p>
      <p className="essai-texte">
        {derniere === null
          ? `Seuil : ${reglages.seuilTouche} ms de retour au plus.`
          : `Dernier retour : ${derniere} ms · médiane : ${median} ms (seuil ${reglages.seuilTouche} ms)`}
      </p>
      <button type="button" className="btn ghost small" onClick={() => onDone(false)}>
        Je n’y arrive pas
      </button>
    </div>
  );
}
