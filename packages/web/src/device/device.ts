import {
  classifyDevice,
  DEVICE_KINDS,
  orientationOf,
  uiScaleFor,
  type DeviceInfo,
  type DeviceKind,
} from '@partyhub/shared';

/**
 * Type d'appareil détecté dans le navigateur. Le serveur ne voit que l'identifiant :
 * ici on connaît aussi la taille de la fenêtre et le type de pointeur, plus fiables.
 * L'utilisateur peut corriger le choix (réglage gardé sur l'appareil).
 *
 * Le résultat pilote des attributs sur <html> (data-device, data-orientation, data-touch)
 * et la variable --ui-scale, lue par les feuilles de style.
 */

const OVERRIDE_KEY = 'ph:device';

export type DeviceChoice = Exclude<DeviceKind, 'unknown'> | 'auto';

/** Choix proposés à l'utilisateur (« unknown » n'a pas de sens comme choix). */
export const DEVICE_CHOICES: DeviceChoice[] = ['auto', 'phone', 'tablet', 'tv', 'desktop'];

function isKind(value: string | null): value is DeviceKind {
  return value !== null && (DEVICE_KINDS as readonly string[]).includes(value);
}

export function readDeviceChoice(): DeviceChoice {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return isKind(raw) && raw !== 'unknown' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeDeviceChoice(choice: DeviceChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, choice);
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}

function measure(): DeviceInfo {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const canHover = window.matchMedia?.('(hover: hover)').matches ?? true;
  const kind = classifyDevice({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    width,
    height,
    coarsePointer,
    canHover,
  });
  return {
    kind,
    width,
    height,
    touch: coarsePointer || navigator.maxTouchPoints > 0,
    orientation: orientationOf(width, height),
  };
}

let current: DeviceInfo = resolve();
const listeners = new Set<() => void>();

/** Type retenu : le choix de l'utilisateur prime sur la détection. */
function resolve(): DeviceInfo {
  const detected = measure();
  const choice = readDeviceChoice();
  return choice === 'auto' ? detected : { ...detected, kind: choice };
}

function apply(info: DeviceInfo): void {
  const root = document.documentElement;
  root.dataset.device = info.kind;
  root.dataset.orientation = info.orientation ?? 'landscape';
  root.dataset.touch = info.touch ? 'true' : 'false';
  root.style.setProperty(
    '--ui-scale',
    String(uiScaleFor(info.kind, info.width ?? 1280, info.height ?? 720)),
  );
}

function refresh(): void {
  const next = resolve();
  const changed =
    next.kind !== current.kind ||
    next.width !== current.width ||
    next.height !== current.height ||
    next.touch !== current.touch;
  current = next;
  apply(current);
  if (changed) listeners.forEach((fn) => fn());
}

let started = false;

/** À appeler une fois au démarrage : applique les attributs et suit les changements de fenêtre. */
export function initDevice(): void {
  if (started) return;
  started = true;
  apply(current);
  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 120);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
}

/** Informations à transmettre au serveur à chaque connexion d'une place ou d'un spectateur. */
export function getDevice(): DeviceInfo {
  return current;
}

export function subscribeDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Change le type d'appareil (choix manuel) ou revient à la détection automatique. */
export function setDeviceChoice(choice: DeviceChoice): void {
  writeDeviceChoice(choice);
  refresh();
}
