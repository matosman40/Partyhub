import { useSyncExternalStore, type ImgHTMLAttributes, type SVGProps } from 'react';

/**
 * Médias de l’installation (bibliothèque, avatars, images générées, sons) pour les jeux.
 *
 * Sur la page, un média se lit directement sur le serveur. Dans la vue d’un jeu de code (iframe sans réseau), la
 * vue expose `__partyhubMedia` : l’octet passe alors par la page, qui le sert après contrôle de l’adresse
 * (voir CodeFrame). Les fonctions et composants de ce module marchent dans les deux cas.
 */

export interface RelayedMedia {
  type: string;
  data: ArrayBuffer;
}

interface MediaRelay {
  get(url: string): Promise<RelayedMedia>;
}

function relay(): MediaRelay | null {
  return (globalThis as { __partyhubMedia?: MediaRelay }).__partyhubMedia ?? null;
}

/** Vrai dans une vue de jeu de code : les médias passent par le relais de la page. */
export function usesMediaRelay(): boolean {
  return relay() !== null;
}

/** Octets d’un média de l’installation. Lève une erreur si le média est absent ou refusé. */
export async function loadMediaBytes(url: string): Promise<ArrayBuffer> {
  const source = relay();
  if (source) return (await source.get(url)).data;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Média indisponible (${res.status}).`);
  return res.arrayBuffer();
}

const objectUrls = new Map<string, string>();
const loading = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number {
  return version;
}

/**
 * Adresse à donner à une balise (image, vidéo, audio, image SVG). Hors relais, c’est l’adresse elle-même. Dans une
 * vue de jeu de code, l’adresse n’existe qu’une fois le média reçu : `null` pendant le chargement, `false` s’il a échoué.
 */
export function useMediaUrl(url: string | null | undefined): string | null | false {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!url) return null;
  const source = relay();
  if (!source) return url;
  const ready = objectUrls.get(url);
  if (ready) return ready;
  if (failed.has(url)) return false;
  if (!loading.has(url)) {
    loading.add(url);
    source.get(url).then(
      ({ type, data }) => {
        objectUrls.set(url, URL.createObjectURL(new Blob([data], { type })));
        loading.delete(url);
        version++;
        for (const listener of listeners) listener();
      },
      () => {
        loading.delete(url);
        failed.add(url);
        version++;
        for (const listener of listeners) listener();
      },
    );
  }
  return null;
}

/** Image SVG (`<image>`) dont l’adresse est un média de l’installation. Rien tant qu’elle n’est pas prête. */
export function MediaImage({ url, ...rest }: { url: string } & Omit<SVGProps<SVGImageElement>, 'href'>) {
  const src = useMediaUrl(url);
  if (!src) return null;
  return <image href={src} {...rest} />;
}

/** Image HTML dont l’adresse est un média de l’installation. Rien tant qu’elle n’est pas prête. */
export function MediaImg({ url, ...rest }: { url: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const src = useMediaUrl(url);
  if (!src) return null;
  return <img src={src} {...rest} />;
}
