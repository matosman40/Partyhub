import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { assetFontFamily } from '@partyhub/games/client';

/** Médiathèque : fichiers audio, vidéo et images réutilisables par les jeux de questions. */

export interface AssetRecord {
  id: string;
  kind: 'audio' | 'video' | 'image' | 'font';
  mime: string;
  name: string;
  size: number;
  createdAt: string;
  usedBy: string[];
}

export type AssetLimits = Record<AssetRecord['kind'], number>;

const MB = 1024 * 1024;

const KIND_LABEL: Record<AssetRecord['kind'], string> = {
  audio: 'Son',
  video: 'Vidéo',
  image: 'Image',
  font: 'Police',
};

/** Type de fichier déduit du type MIME ou de l’extension (le serveur contrôle le contenu réel). */
function kindOf(file: File): AssetRecord['kind'] {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('font/') || /\.(woff2?|ttf|otf)$/i.test(file.name)) return 'font';
  return 'video';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export function AssetLibrary({ onChanged }: { onChanged?: () => void }) {
  const [assets, setAssets] = useState<AssetRecord[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState<AssetLimits | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const sizeOf = (kind: AssetRecord['kind']) => (limits ? `${Math.round(limits[kind] / MB)} Mo` : '…');

  async function load() {
    try {
      const res = await api<{ assets: AssetRecord[]; limits?: AssetLimits }>('/api/admin/assets');
      setAssets(res.assets);
      setLimits(res.limits ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function upload(file: File) {
    setError(null);
    // Contrôle indicatif avant envoi, d’après le type déclaré. Le serveur reste seul juge.
    const kind = kindOf(file);
    const limitBytes = limits?.[kind];
    if (limitBytes !== undefined && file.size > limitBytes) {
      setError(
        `« ${file.name} » est trop volumineux (maximum ${Math.round(limitBytes / MB)} Mo pour ce type de fichier).`,
      );
      if (input.current) input.current.value = '';
      return;
    }
    setBusy(`Envoi de « ${file.name} »…`);
    try {
      // Corps brut : le serveur contrôle le contenu réel du fichier, pas seulement son type déclaré.
      const res = await fetch('/api/admin/assets', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Envoi refusé.');
      await load();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(asset: AssetRecord) {
    if (!window.confirm(`Supprimer « ${asset.name} » de la médiathèque ?`)) return;
    setError(null);
    try {
      await api(`/api/admin/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' });
      await load();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Les fichiers envoyés ici servent aux extraits des jeux de questions et aux dos de carte. Audio : MP3, WAV, OGG,
        M4A ({sizeOf('audio')}
        maximum). Vidéo : MP4 ou WebM ({sizeOf('video')} maximum). Image : PNG, JPEG ou WebP ({sizeOf('image')}{' '}
        maximum). Police : WOFF2, WOFF, TTF ou OTF ({sizeOf('font')} maximum). Le format est vérifié sur le contenu du
        fichier. N’envoyez que des médias dont vous avez le droit d’usage.
      </p>

      <div className="ed-new">
        <label className="btn primary">
          Ajouter un fichier
          <input
            ref={input}
            type="file"
            accept="audio/*,video/*,image/*,.woff2,.woff,.ttf,.otf"
            className="sr-only"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        {busy && (
          <span className="muted" role="status">
            {busy}
          </span>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {assets === null && <p className="muted">Chargement…</p>}
      {assets?.length === 0 && <p className="muted">La médiathèque est vide.</p>}

      <ul className="ed-list">
        {assets?.map((a) => (
          <li key={a.id} className="ed-list-item asset-item">
            <div className="asset-preview">
              {a.kind === 'audio' && <audio controls preload="metadata" src={`/api/assets/${a.id}`} />}
              {a.kind === 'video' && <video controls preload="metadata" src={`/api/assets/${a.id}`} />}
              {a.kind === 'image' && <img src={`/api/assets/${a.id}`} alt="" loading="lazy" />}
              {a.kind === 'font' && (
                <span className="asset-font-sample" style={{ fontFamily: `${assetFontFamily(a.id)}, sans-serif` }}>
                  Aa Bb 123
                </span>
              )}
            </div>
            <div className="ed-list-body">
              <strong>{a.name}</strong>
              <span className="muted small">
                {KIND_LABEL[a.kind]} · {formatSize(a.size)} ·{' '}
                {a.usedBy.length > 0 ? `utilisé dans : ${a.usedBy.join(', ')}` : 'non utilisé'}
              </span>
            </div>
            <div className="ed-list-actions">
              <button
                type="button"
                className="btn ghost small"
                disabled={a.usedBy.length > 0}
                title={
                  a.usedBy.length > 0 ? 'Retirez ce fichier des jeux qui l’utilisent avant de le supprimer.' : undefined
                }
                onClick={() => remove(a)}
              >
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
