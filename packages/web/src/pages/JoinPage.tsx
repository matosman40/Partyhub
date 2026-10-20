import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { api } from '../api.js';
import { isValidRoomCode, ROOM_CODE_MAX_LENGTH } from '@partyhub/shared';
import { QrScanner, canScanQr } from '../components/QrScanner.js';
import { useMusicSlot } from '../sounds.js';

/** Extrait le code de salle d’un QR code (lien /j/CODE) ou d’un code saisi à la main. */
export function codeFromScan(value: string): string | null {
  const fromLink = value.match(/\/j\/([0-9]{4,6})(?:[/?#]|$)/);
  if (fromLink?.[1]) return fromLink[1];
  const bare = value.trim();
  return isValidRoomCode(bare) ? bare : null;
}

export function JoinPage() {
  const navigate = useNavigate();
  useMusicSlot('menus');
  const [params] = useSearchParams();
  const [code, setCode] = useState((params.get('code') ?? '').replace(/\D/g, '').slice(0, ROOM_CODE_MAX_LENGTH));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function verifyAndGo(clean: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ exists: boolean }>(`/api/rooms/${encodeURIComponent(clean)}`);
      if (!res.exists) {
        setError('Code inconnu. Vérifiez le code affiché sur l’écran.');
        return;
      }
      navigate(`/j/${clean}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim();
    if (!isValidRoomCode(clean)) {
      setError('Le code de salle comporte de 4 à 6 chiffres.');
      return;
    }
    void verifyAndGo(clean);
  }

  function onScanned(value: string) {
    setScanning(false);
    const found = codeFromScan(value);
    if (!found) {
      setError('Ce QR code ne correspond pas à une salle PartyHub.');
      return;
    }
    setCode(found);
    void verifyAndGo(found);
  }

  return (
    <main className="page player center fade-in">
      <h1>Rejoindre une salle</h1>

      {scanning ? (
        <QrScanner onResult={onScanned} onClose={() => setScanning(false)} />
      ) : (
        <form className="stack" onSubmit={submit}>
          <label className="field big-field">
            <span>Code affiché sur l’écran</span>
            <input
              className="code-input"
              value={code}
              placeholder="1234"
              maxLength={ROOM_CODE_MAX_LENGTH}
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_MAX_LENGTH))}
              autoFocus
            />
          </label>
          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? 'Vérification…' : 'Continuer'}
          </button>
          {canScanQr() && (
            <button type="button" className="btn big" disabled={busy} onClick={() => setScanning(true)}>
              Scanner le QR code
            </button>
          )}
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Breadcrumb items={[{ label: 'Accueil', to: '/' }, { label: 'Rejoindre une salle' }]} />
    </main>
  );
}
