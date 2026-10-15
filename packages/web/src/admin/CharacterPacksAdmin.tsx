import { useState } from 'react';
import { PackFigure, refreshCharacterPacks, useCharacterPacks } from '@partyhub/games/client';
import { api } from '../api.js';

/** Nom proposé d'après le fichier : « 86b0…-PartyHub-sprites-Dewi-Sri.zip » → « Dewi Sri ». */
export function suggestPackName(fileName: string): string {
  const base = fileName.replace(/\.zip$/i, '');
  const afterSprites = /sprites?[-_ ]+(.+)$/i.exec(base);
  const raw = afterSprites?.[1] ?? base;
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ')
    .slice(0, 60);
}

/**
 * Personnages illustrés : import d'un zip de sprites (json/ et atlas/), liste et suppression.
 * Le zip ne sert qu'à construire le pack ; seules les planches PNG et leurs cases sont conservées.
 */
export function CharacterPacksAdmin({ onChanged }: { onChanged?: () => void }) {
  const { packs, status } = useCharacterPacks();
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  function chooseFile(next: File | null) {
    setFile(next);
    setError(null);
    setIssues([]);
    setNotice(null);
    if (next && !name.trim()) setName(suggestPackName(next.name));
  }

  async function importPack() {
    if (!file) {
      setError('Choisissez un fichier .zip.');
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    setNotice(null);
    try {
      const params = new URLSearchParams({ nom: name.trim(), confirme: consent ? '1' : '0' });
      const res = await fetch(`/api/admin/character-packs?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await file.arrayBuffer(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: string[];
        pack?: { name: string };
      };
      if (!res.ok || !data.pack) {
        setError(data.error ?? 'Import impossible.');
        setIssues(data.issues ?? []);
        return;
      }
      setNotice(`« ${data.pack.name} » est ajouté. Il apparaît dans le choix du personnage du profil.`);
      setFile(null);
      setFileKey((k) => k + 1);
      setName('');
      setConsent(false);
      await refreshCharacterPacks();
      onChanged?.();
    } catch {
      setError('Connexion impossible. Vérifiez le réseau.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (
      !window.confirm(
        `Supprimer le personnage « ${label} » ? Les joueurs qui l'ont choisi retrouvent le personnage dessiné.`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/admin/character-packs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshCharacterPacks();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <p className="muted small">
        Un zip de sprites contient les dossiers <code>json/</code> et <code>atlas/</code> (planches <code>visages</code>{' '}
        et <code>poses</code> obligatoires, <code>marche</code> facultative). Le format est décrit dans
        docs/PERSONNAGES-PACK.md.
      </p>

      <div className="stack pack-admin-form">
        <label className="field">
          <span>Fichier .zip</span>
          <input
            key={fileKey}
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="field">
          <span>Nom affiché</span>
          <input
            type="text"
            value={name}
            maxLength={60}
            disabled={busy}
            placeholder="Par exemple : Dewi Sri"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="pack-admin-consent">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Je confirme que la personne représentée a donné son accord pour que ce personnage soit utilisé dans
            PartyHub.
          </span>
        </label>
        <div>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !file || !consent}
            onClick={() => void importPack()}
          >
            {busy ? 'Import en cours…' : 'Importer le personnage'}
          </button>
        </div>
        {notice && <p className="notice">{notice}</p>}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {issues.length > 0 && (
              <ul>
                {issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <h3>Personnages importés</h3>
      {status !== 'ready' && packs.length === 0 && <p className="muted small">Chargement…</p>}
      {status === 'ready' && packs.length === 0 && (
        <p className="muted small">Aucun personnage illustré pour l’instant.</p>
      )}
      <ul className="pack-admin-list">
        {packs.map((pack) => (
          <li key={pack.id} className="pack-admin-item">
            <span className="pack-admin-thumb">
              <PackFigure pack={pack} framing="bust" />
            </span>
            <span className="pack-admin-name">
              <strong>{pack.name}</strong>
              <span className="muted small">
                {Object.keys(pack.atlases).join(', ')} · identifiant {pack.id}
              </span>
            </span>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove(pack.id, pack.name)}>
              Supprimer
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
