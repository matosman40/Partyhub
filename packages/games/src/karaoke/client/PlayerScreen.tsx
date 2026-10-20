import { useRef, useState } from 'react';
import { parseTimeInput, parseYoutubeId, youtubeStartFromUrl } from '@partyhub/shared';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { canUseMedia, requestMicrophone, useMediaPrefs } from '../../client/media.js';
import { recordClip } from '../../imite-moi/client/media-capture.js';

interface Hit {
  videoId: string;
  title: string;
  channel: string;
}

/** Vidéo choisie : vérifiée par le serveur (durée connue), ou collée sans vérification si le serveur n’a pas de clé. */
interface Checked extends Hit {
  durationSec: number | null;
}

const STAR_LABELS = ['1 étoile', '2 étoiles', '3 étoiles', '4 étoiles', '5 étoiles'];

function formatTime(total: number): string {
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** Message en français pour un refus ou une absence de micro (les autres messages viennent déjà en français). */
function micMessage(err: unknown): string {
  if (!canUseMedia()) return 'Le micro n’est pas disponible sur cette page : ouvrez PartyHub en HTTPS.';
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Accès au micro refusé. Autorisez-le dans les réglages du navigateur, puis réessayez.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Aucun micro trouvé sur cet appareil.';
  if (err instanceof Error && name === 'Error') return err.message;
  return 'Impossible d’utiliser le micro.';
}

async function searchVideos(query: string): Promise<{ hits: Hit[] } | { error: string }> {
  try {
    const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
    const body = (await response.json().catch(() => null)) as { results?: Hit[]; error?: string } | null;
    if (!response.ok || !body?.results) return { error: body?.error ?? 'La recherche ne répond pas.' };
    return { hits: body.results };
  } catch {
    return { error: 'La recherche ne répond pas. Vérifiez la connexion, ou collez un lien YouTube.' };
  }
}

async function checkVideo(videoId: string): Promise<{ video: Checked } | { error: string; code?: string }> {
  try {
    const response = await fetch(`/api/youtube/video?id=${encodeURIComponent(videoId)}`);
    const body = (await response.json().catch(() => null)) as { video?: Checked; error?: string; code?: string } | null;
    if (!response.ok || !body?.video) {
      return { error: body?.error ?? 'Cette vidéo ne peut pas être vérifiée.', code: body?.code };
    }
    return { video: body.video };
  } catch {
    return { error: 'La vérification ne répond pas. Vérifiez la connexion.' };
  }
}

/** Téléphone : chercher ou coller une vidéo et chanter le passage, puis noter les autres. */
export function KaraokePlayer({ publicState: pub, playerState: me, send, now }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [prefs] = useMediaPrefs();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [link, setLink] = useState('');
  const [chosen, setChosen] = useState<Checked | null>(null);
  const [startText, setStartText] = useState('0:00');
  const [searching, setSearching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Micro du passage en cours, et drapeau posé quand le chanteur arrête : la voix n’est alors pas envoyée. */
  const micStream = useRef<MediaStream | null>(null);
  const passageStopped = useRef(false);
  if (!pub) return null;

  const seconds = Math.ceil(remaining / 1000);

  async function run(type: string, payload: unknown, fallback: string) {
    setBusy(true);
    setError(null);
    const result = await send(type, payload);
    setBusy(false);
    if (!result.ok) setError(result.error ?? fallback);
  }

  /** Le chanteur arrête son passage : le micro se coupe tout de suite, et la voix enregistrée n’est pas envoyée. */
  function abandonSong() {
    passageStopped.current = true;
    micStream.current?.getTracks().forEach((track) => track.stop());
    void run('abandon', {}, 'Passage refusé.');
  }

  async function search() {
    const text = query.trim();
    if (text.length < 2) {
      setError('Tapez au moins deux caractères.');
      return;
    }
    setError(null);
    setSearching(true);
    const result = await searchVideos(text);
    setSearching(false);
    if ('error' in result) {
      setError(result.error);
      setHits(null);
    } else {
      setHits(result.hits);
    }
  }

  /** Vérifie la vidéo choisie avant de la proposer : un lien ou un résultat peut ne plus être lisible. */
  async function choose(videoId: string, startFrom: number | null) {
    setError(null);
    setChecking(true);
    const result = await checkVideo(videoId);
    setChecking(false);
    if ('error' in result) {
      // Pas de clé sur le serveur : la vérification est impossible, mais le lien collé reste utilisable (sans durée connue).
      // Une recherche n’existe pas sans clé, donc ce cas ne concerne que les liens.
      if (result.code === 'disabled') {
        setChosen({ videoId, title: `Vidéo ${videoId}`, channel: '', durationSec: null });
        if (startFrom !== null) setStartText(formatTime(startFrom));
        return;
      }
      setChosen(null);
      setError(result.error);
      return;
    }
    setChosen(result.video);
    if (startFrom !== null) setStartText(formatTime(startFrom));
  }

  function chooseFromLink() {
    const videoId = parseYoutubeId(link);
    if (!videoId) {
      setError('Ce lien ne ressemble pas à une vidéo YouTube.');
      return;
    }
    void choose(videoId, youtubeStartFromUrl(link));
  }

  /** Le micro est demandé au geste du joueur, puis le passage part sur l’écran, et la voix est enregistrée. */
  async function sing() {
    if (!chosen) return;
    const startSec = startText.trim() === '' ? 0 : parseTimeInput(startText);
    if (startSec === null) {
      setError('Indiquez le début du passage, par exemple 1:30.');
      return;
    }
    if (chosen.durationSec !== null && startSec >= chosen.durationSec) {
      setError(`Le passage doit commencer avant la fin de la vidéo (${formatTime(chosen.durationSec)}).`);
      return;
    }
    setError(null);
    passageStopped.current = false;
    let stream: MediaStream;
    try {
      stream = await requestMicrophone(prefs);
    } catch (err) {
      setError(micMessage(err));
      return;
    }
    micStream.current = stream;
    const stop = () => stream.getTracks().forEach((track) => track.stop());
    setBusy(true);
    const started = await send('sing', {
      videoId: chosen.videoId,
      title: chosen.title,
      channel: chosen.channel,
      startSec,
    });
    setBusy(false);
    if (!started.ok) {
      stop();
      setError(started.error ?? 'Passage refusé.');
      return;
    }
    setRecording(true);
    try {
      const clip = await recordClip(stream, (pub.segmentSeconds ?? 12) * 1000);
      stop();
      setRecording(false);
      // Arrêt pendant l’enregistrement : l’écran a déjà passé à la suite, la voix n’est pas envoyée.
      if (passageStopped.current) return;
      const sent = await send('recording', { dataUrl: clip });
      if (!sent.ok) setError(sent.error ?? 'Enregistrement refusé.');
    } catch (err) {
      stop();
      setRecording(false);
      if (passageStopped.current) return;
      // Le passage s’arrête tout de suite plutôt que d’attendre la fin du délai.
      await send('abandon', {});
      setError(`${micMessage(err)} Votre passage est arrêté.`);
    }
  }

  if (pub.phase === 'ready') {
    return <p className="notice">Le karaoké commence bientôt : l’ordre de passage arrive sur l’écran principal.</p>;
  }

  if (pub.phase === 'final') {
    return (
      <section className="karaoke-play fade-in">
        <h2>Partie terminée</h2>
        {me?.rank && (
          <p className="notice">
            Vous êtes {me.rank}ᵉ · {me.points ?? 0} points
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'pick') {
    if (!me?.isSinger) {
      return (
        <section className="karaoke-play fade-in">
          <h2 className="karaoke-title">{pub.singerName} choisit sa chanson</h2>
          <p className="muted small">Préparez-vous à chanter le prochain passage.</p>
          <p className="karaoke-count">{seconds} s</p>
        </section>
      );
    }

    return (
      <section className="karaoke-play fade-in">
        <h2 className="karaoke-title">À vous de chanter</h2>
        <p className="karaoke-count">{seconds} s pour choisir</p>

        <form
          className="karaoke-search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label className="field">
            <span>Chanson à chercher</span>
            <input
              value={query}
              maxLength={80}
              placeholder="Artiste ou titre"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={searching || checking || busy}>
            {searching ? 'Recherche…' : 'Chercher'}
          </button>
        </form>

        {hits && hits.length === 0 && <p className="muted small">Aucun résultat. Essayez d’autres mots.</p>}
        {hits && hits.length > 0 && (
          <ul className="karaoke-hits">
            {hits.map((hit) => (
              <li key={hit.videoId}>
                <button
                  type="button"
                  className={`choice-btn ${chosen?.videoId === hit.videoId ? 'selected' : ''}`}
                  disabled={checking}
                  onClick={() => void choose(hit.videoId, null)}
                >
                  <span className="karaoke-hit-title">{hit.title}</span>
                  {hit.channel && <span className="muted small">{hit.channel}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="karaoke-search"
          onSubmit={(e) => {
            e.preventDefault();
            chooseFromLink();
          }}
        >
          <label className="field">
            <span>Ou collez un lien YouTube</span>
            <input value={link} placeholder="https://youtu.be/…" onChange={(e) => setLink(e.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={checking || busy}>
            {checking ? 'Vérification…' : 'Vérifier'}
          </button>
        </form>

        {chosen && (
          <div className="karaoke-chosen">
            <p>
              <strong>{chosen.title}</strong>
              {chosen.channel && <span className="muted small"> · {chosen.channel}</span>}
            </p>
            <p className="muted small">
              {chosen.durationSec === null
                ? 'Durée inconnue : ce serveur ne vérifie pas les vidéos.'
                : `Durée : ${formatTime(chosen.durationSec)}`}
            </p>
            <label className="field">
              <span>Début du passage (1:30, par exemple)</span>
              <input value={startText} maxLength={10} onChange={(e) => setStartText(e.target.value)} />
            </label>
            <button type="button" className="btn primary" disabled={busy || checking} onClick={() => void sing()}>
              Je chante ce passage
            </button>
            <p className="muted small">Le micro s’active au moment où vous appuyez. Le passage joue sur l’écran.</p>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'sing') {
    if (me?.isSinger) {
      return (
        <section className="karaoke-play fade-in">
          <h2 className="karaoke-title">Chantez !</h2>
          <p className="karaoke-count">{recording ? `Enregistrement en cours · ${seconds} s` : 'Préparation'}</p>
          <button type="button" className="link-btn" disabled={busy} onClick={abandonSong}>
            {recording ? 'Arrêter mon passage' : 'Je ne peux pas chanter, passer mon tour'}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      );
    }
    return (
      <section className="karaoke-play fade-in">
        <h2 className="karaoke-title">{pub.singerName} chante</h2>
        <p className="muted small">Chantez avec l’écran principal, votre tour viendra.</p>
        <p className="karaoke-count">{seconds} s</p>
      </section>
    );
  }

  if (pub.phase === 'replay') {
    return (
      <section className="karaoke-play fade-in">
        <h2 className="karaoke-title">{pub.singerName}</h2>
        <p className="notice">Écoutez le rejeu sur l’écran principal.</p>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    if (me?.isSinger) {
      return (
        <section className="karaoke-play fade-in">
          <h2 className="karaoke-title">À vous les notes</h2>
          <p className="notice">Les autres joueurs notent votre passage.</p>
        </section>
      );
    }
    const rated = me?.myRating !== null && me?.myRating !== undefined;
    return (
      <section className="karaoke-play fade-in">
        <h2 className="karaoke-title">Notez {pub.singerName}</h2>
        <div className="karaoke-stars" role="group" aria-label="Note de 1 à 5 étoiles">
          {[1, 2, 3, 4, 5].map((stars) => (
            <button
              key={stars}
              type="button"
              className={`karaoke-star ${me?.myRating === stars ? 'selected' : ''}`}
              aria-label={STAR_LABELS[stars - 1]}
              aria-pressed={me?.myRating === stars}
              disabled={busy || rated}
              onClick={() => void run('rate', { stars }, 'Note refusée.')}
            >
              ★
            </button>
          ))}
        </div>
        {rated && <p className="notice">Note enregistrée ✔</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  // Révélation
  const gained = me?.gained ?? 0;
  return (
    <section className="karaoke-play fade-in">
      <h2 className="karaoke-title">{pub.singerName}</h2>
      {pub.average !== null && pub.average !== undefined && (
        <p className="karaoke-count">Moyenne : {Number(pub.average).toFixed(1).replace('.', ',')} sur 5</p>
      )}
      <p className="notice">
        {pub.abandoned
          ? me?.isSinger
            ? 'Vous avez arrêté votre passage. Aucun point.'
            : `${pub.singerName} a arrêté son passage. Aucun point.`
          : me?.isSinger
            ? gained > 0
              ? `+${gained} points pour votre passage`
              : 'Pas de note pour votre passage cette fois'
            : gained > 0
              ? `${pub.singerName} gagne ${gained} points`
              : 'Aucun point pour ce passage'}
      </p>
      {me?.rank && <p className="muted small">Vous êtes {me.rank}ᵉ</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
