// Mock NPCI ONMAGS e-Mandate portal.
//
// Flow it simulates:
//   1. Merchant portal auto-submits a form (MerchantID, MandateReqDoc, CheckSumVal, ...)
//      to POST /onmags/sendRequest.
//   2. The customer "authenticates" at their bank and approves/rejects (POST /onmags/authorize).
//   3. ONMAGS redirects the browser back to the merchant's registered return URL by
//      rendering an auto-submitting HTML form (Content-Type: application/x-www-form-urlencoded)
//      whose MandateRespDoc field carries the XML response.
import crypto from 'node:crypto';
import express from 'express';
import {
  buildMandateResponse,
  checksum,
  escapeXml as esc,
  parseMandateRequest,
  safeEqual,
} from './xml.js';

const PORT = Number(process.env.PORT ?? 4000);
const CHECKSUM_KEY = process.env.CHECKSUM_KEY ?? 'demo-shared-secret';

// In ONMAGS the return URL is registered per merchant during onboarding, it is
// not taken from the request. We mirror that with a small registry.
const MERCHANTS = {
  MERCHANT01: {
    name: 'Demo Merchant Pvt Ltd',
    returnUrl: process.env.MERCHANT_RETURN_URL ?? 'http://localhost:5173/npci/response',
  },
};

// Illustrative reason codes only; use the code list from the NPCI spec.
const REJECT_REASONS = {
  AP10: { desc: 'Customer cancelled the mandate', by: 'CUSTOMER' },
  AP19: { desc: 'Authentication failed at bank', by: 'BANK' },
  AP21: { desc: 'Account inactive / frozen', by: 'BANK' },
};

const pending = new Map(); // txnId -> { req, returnUrl }

const app = express();
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

const page = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#0b2a4a;color:#1b1b1b;margin:0;padding:24px}
  .card{max-width:640px;margin:0 auto;background:#fff;border-radius:10px;padding:24px 28px;box-shadow:0 4px 24px #0004}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#666;margin:0 0 16px;font-size:13px}
  .badge{display:inline-block;background:#f28c28;color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:6px 4px;border-bottom:1px solid #eee;font-size:14px}
  td:first-child{color:#666;width:45%}button{font-size:15px;padding:10px 18px;border-radius:6px;border:0;cursor:pointer;margin-right:8px}
  .ok{background:#1a7f37;color:#fff}.no{background:#b42318;color:#fff}select,textarea,input{font:inherit;padding:6px;width:100%;box-sizing:border-box}
  pre{background:#f5f5f5;padding:12px;overflow:auto;font-size:12px}
</style></head><body><div class="card">${body}</div></body></html>`;

app.get('/', (_req, res) => {
  res.send(page('Mock NPCI ONMAGS', `
    <span class="badge">MOCK</span>
    <h1>NPCI ONMAGS – e-Mandate (mock)</h1>
    <p class="sub">Start the flow from the merchant portal (http://localhost:5173). This server only receives
    mandate requests and redirects the browser back with the XML response.</p>
    <p>Registered merchants:</p>
    <pre>${esc(JSON.stringify(MERCHANTS, null, 2))}</pre>`));
});

// Step 1: merchant portal posts the mandate request here (browser form POST).
app.post('/onmags/sendRequest', (req, res) => {
  const { MerchantID, CheckSumVal, BankID, AuthMode } = req.body ?? {};
  // Browsers turn every newline inside a form field into CRLF when submitting,
  // so normalise back to LF (as any XML parser does) before checking the checksum.
  const MandateReqDoc = req.body?.MandateReqDoc?.replace(/\r\n?/g, '\n');
  const merchant = MERCHANTS[MerchantID];
  if (!merchant) return res.status(400).send(page('Error', `<h1>Unknown MerchantID</h1>`));
  if (!MandateReqDoc || !safeEqual(checksum(MandateReqDoc, CHECKSUM_KEY), CheckSumVal)) {
    return res.status(400).send(page('Error', `<h1>Checksum validation failed</h1>`));
  }

  let mandate;
  try {
    mandate = parseMandateRequest(MandateReqDoc);
  } catch (err) {
    return res.status(400).send(page('Error', `<h1>Invalid MandateReqDoc</h1><pre>${esc(err.message)}</pre>`));
  }

  const txnId = crypto.randomUUID();
  pending.set(txnId, { req: mandate, returnUrl: merchant.returnUrl });

  const rows = [
    ['Merchant', `${mandate.merchantName} (${mandate.merchantId})`],
    ['Mandate request id', mandate.mndtReqId],
    ['Debtor', mandate.debtorName],
    ['Account', `${mandate.debtorAccount} (${mandate.debtorAccountType})`],
    ['Bank (IFSC)', `${mandate.debtorBankIfsc} / ${BankID ?? ''}`],
    ['Max amount', `${mandate.currency} ${mandate.maxAmount}`],
    ['Frequency', mandate.frequency],
    ['Period', `${mandate.firstCollectionDate} → ${mandate.finalCollectionDate || 'Until cancelled'}`],
    ['Auth mode', AuthMode ?? 'NetBanking'],
  ];

  res.send(page('Authorise e-Mandate', `
    <span class="badge">MOCK BANK AUTH</span>
    <h1>Authorise e-Mandate</h1>
    <p class="sub">You were redirected here by ${esc(mandate.merchantName)}. Review and authorise.</p>
    <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>
    <form method="post" action="/onmags/authorize">
      <input type="hidden" name="txnId" value="${esc(txnId)}">
      <p><label>Reject reason (used only when rejecting)<br>
        <select name="reason">${Object.entries(REJECT_REASONS)
          .map(([code, r]) => `<option value="${code}">${code} – ${esc(r.desc)}</option>`).join('')}</select></label></p>
      <button class="ok" name="decision" value="approve">Approve</button>
      <button class="no" name="decision" value="reject">Reject</button>
    </form>`));
});

// Step 2 + 3: build the XML response and redirect the browser back to the merchant.
app.post('/onmags/authorize', (req, res) => {
  const { txnId, decision, reason } = req.body ?? {};
  const txn = pending.get(txnId);
  if (!txn) return res.status(400).send(page('Error', `<h1>Session expired or already used</h1>`));
  pending.delete(txnId);

  const accepted = decision === 'approve';
  const r = REJECT_REASONS[reason] ?? REJECT_REASONS.AP10;
  const xml = buildMandateResponse(txn.req, accepted
    ? { accepted, reasonCode: '000', reasonDesc: 'Mandate accepted', rejectBy: '' }
    : { accepted, reasonCode: reason, reasonDesc: r.desc, rejectBy: r.by });

  const fields = {
    MandateRespDoc: xml,
    CheckSumVal: checksum(xml, CHECKSUM_KEY),
    RespType: accepted ? 'SUCCESS' : 'REJECT',
  };

  // This is the "response redirection": a self-submitting form. The browser
  // sends it as application/x-www-form-urlencoded; the XML travels inside a field.
  res.send(page('Redirecting…', `
    <span class="badge">MOCK</span>
    <h1>Redirecting you back to ${esc(txn.req.merchantName)}…</h1>
    <p class="sub">POST ${esc(txn.returnUrl)}</p>
    <form id="npciResp" method="post" action="${esc(txn.returnUrl)}">
      ${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('\n      ')}
      <noscript><button type="submit">Continue</button></noscript>
    </form>
    <details><summary>MandateRespDoc being posted</summary><pre>${esc(xml)}</pre></details>
    <script>setTimeout(function(){document.getElementById('npciResp').submit();}, 800);</script>`));
});

app.listen(PORT, () => {
  console.log(`Mock NPCI ONMAGS listening on http://localhost:${PORT}`);
});
