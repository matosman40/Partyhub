/**
 * Fournisseurs d’images : chacun transforme une description en octets d’image. Appelés directement par `fetch`,
 * sans SDK, comme le client de texte. Les clés restent sur le serveur ; les messages d’erreur ne contiennent jamais
 * la clé ni le corps de la réponse.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface GeneratedImage {
  bytes: Buffer;
  mime: ImageMime;
}

export interface ImageProvider {
  id: ImageProviderId;
  label: string;
  generate(prompt: string, signal: AbortSignal): Promise<GeneratedImage>;
}

export type ImageProviderId = 'cloudflare' | 'modelscope';

export const IMAGE_PROVIDER_IDS: readonly ImageProviderId[] = ['cloudflare', 'modelscope'];

/** Taille maximale d’une image acceptée, en octets. Au-delà, le fournisseur est considéré en échec. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export class ImageError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}

type FetchFn = typeof fetch;

/** Reconnaît le format d’une image à ses premiers octets. Renvoie null pour tout ce qui n’est pas une image. */
export function sniffImage(bytes: Buffer): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Vérifie une image reçue : format reconnu et taille admise. */
export function checkImage(bytes: Buffer): GeneratedImage {
  if (bytes.length === 0) throw new ImageError('Image vide renvoyée par le fournisseur.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageError('Image trop volumineuse renvoyée par le fournisseur.');
  const mime = sniffImage(bytes);
  if (!mime) throw new ImageError('Réponse du fournisseur qui n’est pas une image.');
  return { bytes, mime };
}

/** Attend `ms`, ou s’arrête tout de suite si le signal est annulé. */
export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ImageError('Génération annulée.'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ImageError('Génération annulée.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function networkError(err: unknown, signal: AbortSignal): ImageError {
  if (signal.aborted) return new ImageError('Génération annulée ou trop longue.', false);
  if (err instanceof ImageError) return err;
  return new ImageError('Connexion au fournisseur d’images impossible.', true);
}

function httpError(label: string, status: number): ImageError {
  return new ImageError(`${label} a répondu ${status}.`, status === 429 || status >= 500);
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI : FLUX.1 schnell (génération synchrone)
// ---------------------------------------------------------------------------

export const CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const CLOUDFLARE_STEPS = 4;

export interface CloudflareOptions {
  accountId: string;
  apiToken: string;
  /** Racine de l’API, pour les tests. Par défaut : l’API publique de Cloudflare. */
  baseUrl?: string;
  fetch?: FetchFn;
}

export function createCloudflareProvider(options: CloudflareOptions): ImageProvider {
  const doFetch = options.fetch ?? fetch;
  const root = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
  const url = `${root}/accounts/${encodeURIComponent(options.accountId)}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`;
  return {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI (FLUX.1 schnell)',
    async generate(prompt, signal) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ prompt, steps: CLOUDFLARE_STEPS }),
          signal,
        });
      } catch (err) {
        throw networkError(err, signal);
      }
      if (!res.ok) throw httpError('Cloudflare', res.status);
      try {
        // Selon le mode d’appel, Cloudflare renvoie l’image brute ou une enveloppe JSON avec l’image en base64.
        if ((res.headers.get('content-type') ?? '').startsWith('image/')) {
          return checkImage(Buffer.from(await res.arrayBuffer()));
        }
        const data = (await res.json()) as { result?: { image?: unknown }; image?: unknown };
        const encoded = data.result?.image ?? data.image;
        if (typeof encoded !== 'string' || encoded.length === 0) {
          throw new ImageError('Réponse Cloudflare sans image.');
        }
        return checkImage(Buffer.from(encoded, 'base64'));
      } catch (err) {
        throw networkError(err, signal);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// ModelScope API-Inference : Qwen-Image (génération asynchrone : soumission, puis interrogation)
// ---------------------------------------------------------------------------

export const MODELSCOPE_IMAGE_MODEL = 'Qwen/Qwen-Image-2.1';
const MODELSCOPE_POLL_MS = 4000;

export interface ModelScopeOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Délai entre deux interrogations de la tâche. */
  pollMs?: number;
  fetch?: FetchFn;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createModelScopeProvider(options: ModelScopeOptions): ImageProvider {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? sleepUnlessAborted;
  const root = (options.baseUrl ?? 'https://api-inference.modelscope.ai').replace(/\/+$/, '');
  const model = options.model ?? MODELSCOPE_IMAGE_MODEL;
  const pollMs = options.pollMs ?? MODELSCOPE_POLL_MS;
  const auth = `Bearer ${options.apiKey}`;
  return {
    id: 'modelscope',
    label: 'ModelScope (Qwen-Image)',
    async generate(prompt, signal) {
      try {
        const submitted = await doFetch(`${root}/v1/images/generations`, {
          method: 'POST',
          headers: {
            authorization: auth,
            'content-type': 'application/json',
            'x-modelscope-async-mode': 'true',
          },
          body: JSON.stringify({ model, prompt }),
          signal,
        });
        if (!submitted.ok) throw httpError('ModelScope', submitted.status);
        const task = (await submitted.json()) as { task_id?: unknown };
        if (typeof task.task_id !== 'string' || task.task_id.length === 0) {
          throw new ImageError('ModelScope n’a pas renvoyé de tâche.');
        }
        for (;;) {
          const polled = await doFetch(`${root}/v1/tasks/${encodeURIComponent(task.task_id)}`, {
            headers: { authorization: auth, 'x-modelscope-task-type': 'image_generation' },
            signal,
          });
          if (!polled.ok) throw httpError('ModelScope', polled.status);
          const state = (await polled.json()) as { task_status?: unknown; status?: unknown; output_images?: unknown };
          const status = String(state.task_status ?? state.status ?? '').toUpperCase();
          if (status === 'SUCCEED') {
            const first = Array.isArray(state.output_images) ? state.output_images[0] : undefined;
            if (typeof first !== 'string' || first.length === 0) {
              throw new ImageError('ModelScope n’a pas renvoyé d’image.');
            }
            const image = await doFetch(first, { signal });
            if (!image.ok) throw httpError('ModelScope', image.status);
            return checkImage(Buffer.from(await image.arrayBuffer()));
          }
          if (status === 'FAILED') throw new ImageError('ModelScope a refusé ou échoué la génération.');
          await sleep(pollMs, signal);
        }
      } catch (err) {
        throw networkError(err, signal);
      }
    },
  };
}
