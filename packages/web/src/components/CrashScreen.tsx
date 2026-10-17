/**
 * Écran affiché à la place d’une page qui a planté. Il ne dépend pas du routeur : il sert aussi au
 * filet de sécurité posé au-dessus de l’application entière.
 */
export function CrashScreen({ error }: { error: Error }) {
  return (
    <main className="page center fade-in crash-screen">
      <h1>Cette page n’a pas pu s’afficher</h1>
      <p>Rechargez la page. Si le problème revient, revenez à l’accueil.</p>
      <div className="crash-actions">
        <button type="button" className="btn primary big" onClick={() => window.location.reload()}>
          Recharger la page
        </button>
        <a className="btn big" href="/">
          Retour à l’accueil
        </a>
      </div>
      <details className="crash-details">
        <summary>Détail technique</summary>
        <pre>{error.message || error.name}</pre>
      </details>
    </main>
  );
}
