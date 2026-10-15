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
 * Personnages illustrés : un personnage peut avoir plusieurs looks (une planche complète chacun).
 * L'import crée un personnage, ou ajoute un look à un personnage existant ; les looks se retirent un à un.
 */
export function CharacterPacksAdmin({ onChanged }: { onChanged?: () => void }) {
  const { packs, status } = useCharacterPacks();
  const [target, setTarget] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [name, setName] = useState('');
  const [lookName, setLookName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const adding = target !== '';
  const targetPack = packs.find((pack) => pack.id === target) ?? null;

  function chooseFile(next: File | null) {
    setFile(next);
    setError(null);
    setIssues([]);
    setNotice(null);
    if (next && !adding && !name.trim()) setName(suggestPackName(next.name));
  }

  function resetForm() {
    setFile(null);
    setFileKey((k) => k + 1);
    setName('');
    setLookName('');
    setConsent(false);
  }

  async function importPack() {
    if (!file) {
      setError('Choisissez un fichier .zip.');
      return;
    }
    if (adding && !lookName.trim()) {
      setError('Donnez un nom au look (par exemple : Fête).');
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    setNotice(null);
    try {
      const params = new URLSearchParams({ confirme: consent ? '1' : '0', look: lookName.trim() });
      if (adding) params.set('pack', target);
      else params.set('nom', name.trim());
      const res = await fetch(`/api/admin/character-packs?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await file.arrayBuffer(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: string[];
        pack?: { name: string };
        look?: { name: string };
      };
      if (!res.ok || !data.pack || !data.look) {
        setError(data.error ?? 'Import impossible.');
        setIssues(data.issues ?? []);
        return;
      }
      setNotice(
        adding
          ? `Le look « ${data.look.name} » est ajouté à ${data.pack.name}. Il se choisit dans le profil.`
          : `« ${data.pack.name} » est ajouté. Il apparaît dans le choix du personnage du profil.`,
      );
      resetForm();
      await refreshCharacterPacks();
      onChanged?.();
    } catch {
      setError('Connexion impossible. Vérifiez le réseau.');
    } finally {
      setBusy(false);
    }
  }

  async function removeLook(packId: string, packName: string, lookId: string, lookLabel: string, lastLook: boolean) {
    const message = lastLook
      ? `Retirer le dernier look « ${lookLabel} » supprime aussi le personnage « ${packName} ». Continuer ?`
      : `Retirer le look « ${lookLabel} » de « ${packName} » ?`;
    if (!window.confirm(message)) return;
    try {
      await api(`/api/admin/character-packs/${encodeURIComponent(packId)}/looks/${encodeURIComponent(lookId)}`, {
        method: 'DELETE',
      });
      await refreshCharacterPacks();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removePack(id: string, label: string) {
    if (
      !window.confirm(
        `Supprimer le personnage « ${label} » et tous ses looks ? Les joueurs qui l'ont choisi retrouvent le personnage dessiné.`,
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
          <span>Ajouter à</span>
          <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Un nouveau personnage</option>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                Un look de {pack.name}
              </option>
            ))}
          </select>
        </label>
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
        {adding ? (
          <p className="muted small">
            Le look sera ajouté à <strong>{targetPack?.name ?? 'ce personnage'}</strong>.
          </p>
        ) : (
          <label className="field">
            <span>Nom du personnage</span>
            <input
              type="text"
              value={name}
              maxLength={60}
              disabled={busy}
              placeholder="Par exemple : Dewi Sri"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>Nom du look</span>
          <input
            type="text"
            value={lookName}
            maxLength={40}
            disabled={busy}
            placeholder={adding ? 'Par exemple : Fête' : 'Standard'}
            onChange={(e) => setLookName(e.target.value)}
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
            {busy ? 'Import en cours…' : adding ? 'Ajouter le look' : 'Importer le personnage'}
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
          <li key={pack.id} className="pack-admin-item pack-admin-character">
            <div className="pack-admin-head">
              <span className="pack-admin-name">
                <strong>{pack.name}</strong>
                <span className="muted small">identifiant {pack.id}</span>
              </span>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void removePack(pack.id, pack.name)}
              >
                Supprimer le personnage
              </button>
            </div>
            <ul className="pack-admin-looks">
              {pack.looks.map((look) => (
                <li key={look.id} className="pack-admin-look">
                  <span className="pack-admin-thumb">
                    <PackFigure pack={pack} look={look} framing="bust" />
                  </span>
                  <span className="muted small">{look.name}</span>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void removeLook(pack.id, pack.name, look.id, look.name, pack.looks.length === 1)}
                  >
                    Retirer ce look
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
