import { useEffect, useState } from 'react';
import { FIELD_MAP, parseMandateResp } from '../npci/parseMandateResp.js';

// Landing route for the NPCI response redirection.
// The backend already received the POST and redirected here with ?rid=...
export default function MandateResponse() {
  const params = new URLSearchParams(window.location.search);
  const rid = params.get('rid');
  const redirectError = params.get('error');

  const [state, setState] = useState({ status: 'loading' });
  const [submit, setSubmit] = useState({ status: 'idle' });
  const [showXml, setShowXml] = useState(false);

  useEffect(() => {
    if (redirectError || !rid) {
      setState({ status: 'error', message: redirectError ?? 'No response id in URL' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/npci/responses/${encodeURIComponent(rid)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        const mandate = parseMandateResp(body.xml); // XML -> mapped fields
        if (!cancelled) {
          setState({ status: 'ready', meta: body, mandate });
          if (body.consumed) setSubmit({ status: 'done', result: { id: body.mandateId }, already: true });
        }
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rid, redirectError]);

  async function submitToBackend() {
    setSubmit({ status: 'submitting' });
    try {
      const res = await fetch('/api/mandates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rid, mandate: state.mandate }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error + (body.mismatches ? `: ${body.mismatches.join(', ')}` : ''));
      setSubmit({ status: 'done', result: body });
    } catch (err) {
      setSubmit({ status: 'error', message: err.message });
    }
  }

  if (state.status === 'loading') return <section className="card">Reading NPCI response…</section>;
  if (state.status === 'error') {
    return (
      <section className="card">
        <h1>Could not read the NPCI response</h1>
        <p className="error">{state.message}</p>
        <a href="/">Back to start</a>
      </section>
    );
  }

  const { meta, mandate } = state;
  return (
    <section className="card">
      <h1>
        e-Mandate {mandate.accepted ? 'accepted' : 'rejected'}{' '}
        <span className={`pill ${mandate.accepted ? 'active' : 'rejected'}`}>{meta.respType || '—'}</span>
      </h1>
      <p className="muted">
        Received {meta.receivedAt} as <code>{meta.contentType.split(';')[0]}</code>. Checksum{' '}
        {meta.checksumValid ? <b className="ok">valid</b> : <b className="error">INVALID</b>}.
      </p>

      <h2>Mapped fields</h2>
      <table className="kv">
        <tbody>
          {FIELD_MAP.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="mono">{String(mandate[f.key]) || '—'}</td>
              <td className="muted small">{f.path.slice(-2).join('/')}{f.attr ? `@${f.attr}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <button className="link" onClick={() => setShowXml(!showXml)}>
          {showXml ? 'Hide' : 'Show'} raw MandateRespDoc
        </button>
      </p>
      {showXml && <pre>{meta.xml}</pre>}

      <div className="actions">
        {submit.status !== 'done' && (
          <button onClick={submitToBackend} disabled={submit.status === 'submitting' || !meta.checksumValid}>
            {submit.status === 'submitting' ? 'Submitting…' : 'Submit to backend'}
          </button>
        )}
        <a href="/">Back to start</a>
      </div>
      {submit.status === 'error' && <p className="error">{submit.message}</p>}
      {submit.status === 'done' && (
        <p className="ok">
          {submit.already ? 'Already saved' : 'Saved'} by backend — record id <code>{submit.result.id}</code>
          {submit.result.status && <> with status <b>{submit.result.status}</b></>}.
        </p>
      )}
    </section>
  );
}
