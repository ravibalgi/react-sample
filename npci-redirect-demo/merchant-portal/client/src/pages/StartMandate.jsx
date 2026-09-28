import { useEffect, useState } from 'react';
import { postForm } from '../npci/postForm.js';

const today = new Date().toISOString().slice(0, 10);

const INITIAL = {
  debtorName: 'Asha Verma',
  debtorAccount: '50100123456789',
  accountType: 'SAVINGS',
  ifsc: 'HDFC0001234',
  maxAmount: '5000',
  frequency: 'MNTH',
  firstCollectionDate: today,
  finalCollectionDate: '',
  authMode: 'NetBanking',
};

export default function StartMandate() {
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mandates, setMandates] = useState([]);

  useEffect(() => {
    fetch('/api/mandates').then((r) => r.json()).then(setMandates).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/mandates/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      // Hand the browser over to NPCI ONMAGS.
      postForm(body.action, body.fields);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h1>Register an e-Mandate</h1>
        <p className="muted">
          Submitting sends you to the (mock) NPCI ONMAGS page. After you approve or reject, NPCI redirects back
          here with an XML response.
        </p>
        <form onSubmit={submit} className="grid">
          <label>Account holder<input value={form.debtorName} onChange={set('debtorName')} required /></label>
          <label>Account number<input value={form.debtorAccount} onChange={set('debtorAccount')} required /></label>
          <label>
            Account type
            <select value={form.accountType} onChange={set('accountType')}>
              <option>SAVINGS</option>
              <option>CURRENT</option>
            </select>
          </label>
          <label>IFSC<input value={form.ifsc} onChange={set('ifsc')} required /></label>
          <label>Max amount (INR)<input type="number" min="1" value={form.maxAmount} onChange={set('maxAmount')} required /></label>
          <label>
            Frequency
            <select value={form.frequency} onChange={set('frequency')}>
              <option value="MNTH">Monthly</option>
              <option value="QURT">Quarterly</option>
              <option value="YEAR">Yearly</option>
              <option value="ADHO">As presented</option>
            </select>
          </label>
          <label>First collection<input type="date" value={form.firstCollectionDate} onChange={set('firstCollectionDate')} required /></label>
          <label>Final collection<input type="date" value={form.finalCollectionDate} onChange={set('finalCollectionDate')} /></label>
          <label>
            Auth mode
            <select value={form.authMode} onChange={set('authMode')}>
              <option>NetBanking</option>
              <option>DebitCard</option>
              <option>Aadhaar</option>
            </select>
          </label>
          <div className="actions">
            <button disabled={busy}>{busy ? 'Redirecting to NPCI…' : 'Proceed to NPCI'}</button>
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>Mandates saved by the backend</h2>
        {mandates.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Status</th><th>UMRN</th><th>Debtor</th><th>Max amount</th><th>Reason</th><th>Saved</th></tr>
            </thead>
            <tbody>
              {mandates.map((m) => (
                <tr key={m.id}>
                  <td><span className={`pill ${m.status.toLowerCase()}`}>{m.status}</span></td>
                  <td className="mono">{m.umrn || '—'}</td>
                  <td>{m.debtorName}</td>
                  <td>{m.currency} {m.maxAmount}</td>
                  <td>{m.reasonCode} {m.reasonDesc}</td>
                  <td>{new Date(m.savedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
