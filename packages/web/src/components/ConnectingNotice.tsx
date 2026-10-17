import { useEffect, useState } from 'react';

/** Au-delà de ce délai, l'attente n'est plus silencieuse : on explique et on propose de réessayer. */
export const CONNECTING_SLOW_MS = 6000;

/**
 * Affichage pendant la connexion à une salle. Jamais un écran vide : après quelques secondes,
 * le message indique quoi vérifier et propose de recharger la page.
 */
export function ConnectingNotice({
  error = null,
  label = 'Connexion à la salle…',
}: {
  error?: string | null;
  label?: string;
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), CONNECTING_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (error) return <p role="alert">{error}</p>;

  return (
    <div className="connecting" role="status" aria-live="polite">
      <p>{label}</p>
      {slow && (
        <>
          <p className="muted small">
            Le salon ne répond pas. Vérifiez que cet appareil est bien connecté au réseau, puis réessayez.
          </p>
          <button type="button" className="btn small" onClick={() => window.location.reload()}>
            Réessayer
          </button>
        </>
      )}
    </div>
  );
}
