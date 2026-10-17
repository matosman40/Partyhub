import { useEffect, useState, type FormEvent } from 'react';
import { BANK_TYPES, BANK_TYPE_INFO, LEVEL_LABELS, type BankType, type Level } from '@partyhub/games/client';
import { api } from '../api.js';
import { authHeaders } from './session.js';

/** Proposer une carte à BOUM ! : seul l’administrateur valide. Les invités n’ont pas cette section. */

type ProposalState = 'en_attente' | 'validee' | 'refusee';

interface MyProposal {
  id: string;
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
  state: ProposalState;
  reason: string | null;
  createdAt: string;
}

interface MyProposals {
  proposals: MyProposal[];
  limits: { pending: number; perDay: number };
}

const STATE_LABELS: Record<ProposalState, string> = {
  en_attente: 'En attente de validation',
  validee: 'Validée',
  refusee: 'Refusée',
};

/** Le niveau « limite » reste réservé à l’administration. */
const PROPOSABLE_LEVELS: Level[] = ['doux', 'corse'];

export function ProposeBoumCard() {
  const [mine, setMine] = useState<MyProposals | null>(null);
  const [type, setType] = useState<BankType>('metier');
  const [level, setLevel] = useState<Level>('doux');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [certified, setCertified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await api<MyProposals>('/api/profiles/me/boum-proposals', { headers: authHeaders() });
    setMine(res);
  }

  useEffect(() => {
    load().catch((err: Error) => setMessage({ ok: false, text: err.message }));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/profiles/me/boum-proposals', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          type,
          level,
          text,
          answer: BANK_TYPE_INFO[type].answer === 'none' ? null : answer,
          certified,
        }),
      });
      setText('');
      setAnswer('');
      setCertified(false);
      setMessage({ ok: true, text: 'Merci : votre proposition attend la validation de l’administrateur.' });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const info = BANK_TYPE_INFO[type];

  return (
    <div className="stack">
      <p className="muted small">
        Proposez une carte pour BOUM ! Elle n’apparaît en partie qu’après validation. Vous ne voyez jamais les textes
        des autres joueurs ni la banque complète.
      </p>

      <form className="stack" onSubmit={submit} aria-label="Proposer une carte">
        <label className="field">
          <span>Type de carte</span>
          <select value={type} onChange={(e) => setType(e.target.value as BankType)}>
            {BANK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BANK_TYPE_INFO[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Niveau</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {PROPOSABLE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Texte de la carte</span>
          <textarea
            value={text}
            maxLength={info.maxLength}
            rows={3}
            required
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {info.answer !== 'none' && (
          <label className="field">
            <span>
              Réponse attendue
              {info.answer === 'int' ? ' (nombre entier)' : info.answer === 'country' ? ' (code pays, par ex. FR)' : ''}
            </span>
            <input value={answer} maxLength={200} required onChange={(e) => setAnswer(e.target.value)} />
          </label>
        )}
        <label className="field row">
          <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} required />
          <span>Ce texte est de ma composition ou libre de droits.</span>
        </label>
        <div className="row wrap">
          <button type="submit" className="btn primary" disabled={busy || !certified}>
            Envoyer ma proposition
          </button>
        </div>
      </form>

      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}

      <h3>Mes propositions</h3>
      {mine === null ? (
        <p className="muted small">Chargement…</p>
      ) : mine.proposals.length === 0 ? (
        <p className="muted small">
          Vous n’avez encore rien proposé. Limite : {mine.limits.pending} en attente, {mine.limits.perDay} par jour.
        </p>
      ) : (
        <ul className="boum-list">
          {mine.proposals.map((p) => (
            <li key={p.id} className="boum-row">
              <div className="stack grow">
                <p className="small">
                  {BANK_TYPE_INFO[p.type].label} · {LEVEL_LABELS[p.level]} · {STATE_LABELS[p.state]}
                </p>
                <p>{p.text}</p>
                {p.answer && <p className="muted small">Réponse : {p.answer}</p>}
                {p.state === 'refusee' && p.reason && <p className="small">Motif : {p.reason}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
