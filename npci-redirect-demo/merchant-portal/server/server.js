// Merchant backend.
//
// A React SPA is static JavaScript: it cannot read the body of a POST that the
// browser made to load a page. So the NPCI return URL must hit a server-side
// endpoint first. This one:
//   1. accepts the POST (form-urlencoded with the XML inside a field, or a raw
//      application/xml / text/xml body),
//   2. verifies the checksum and stores the raw XML under a random one-time id,
//   3. answers 303 See Other -> /mandate/response?rid=<id>  (Post/Redirect/Get),
// after which the React route fetches the XML, maps the fields and submits
// them to POST /api/mandates, which re-validates against the stored XML.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  MERCHANT,
  buildMandateRequest,
  checksum,
  parseMandateResponse,
  safeEqual,
} from './mandateXml.js';

const PORT = Number(process.env.SERVER_PORT ?? 5050);
const CHECKSUM_KEY = process.env.CHECKSUM_KEY ?? 'demo-shared-secret';
const NPCI_URL = process.env.NPCI_URL ?? 'http://localhost:4000/onmags/sendRequest';
const RESPONSE_TTL_MS = 10 * 60 * 1000;
const COMPARE_KEYS = ['npciMsgId', 'merchantMsgId', 'accepted', 'umrn', 'mandateRequestId', 'maxAmount'];

// In-memory stores. Use your database / Redis in a real deployment.
const initiated = new Map(); // merchant MsgId -> { mndtReqId, input, createdAt }
const responses = new Map(); // rid -> { xml, checksumValid, respType, receivedAt, consumed, mandateId }
const mandates = []; // persisted mandate records

setInterval(() => {
  const cutoff = Date.now() - RESPONSE_TTL_MS;
  for (const [rid, r] of responses) if (r.receivedAt < cutoff) responses.delete(rid);
}, 60_000).unref();

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// 1) Outbound: build the mandate request the React app will auto-post to NPCI.
// ---------------------------------------------------------------------------
app.post('/api/mandates/initiate', express.json(), (req, res) => {
  const input = req.body ?? {};
  const missing = ['debtorName', 'debtorAccount', 'ifsc', 'maxAmount', 'frequency', 'firstCollectionDate']
    .filter((k) => !input[k]);
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });

  const { msgId, mndtReqId, xml } = buildMandateRequest(input);
  initiated.set(msgId, { mndtReqId, input, createdAt: Date.now() });

  res.json({
    action: NPCI_URL,
    fields: {
      MerchantID: MERCHANT.id,
      MandateReqDoc: xml,
      CheckSumVal: checksum(xml, CHECKSUM_KEY),
      BankID: input.ifsc.slice(0, 4),
      AuthMode: input.authMode ?? 'NetBanking',
    },
  });
});

// ---------------------------------------------------------------------------
// 2) Inbound: the NPCI response redirection lands here.
//    CSRF protection must NOT be applied to this route (the POST comes from
//    NPCI's origin); authenticity comes from the checksum / signature instead.
//    Note: SameSite=Lax/Strict session cookies are NOT sent on this cross-site
//    POST, they are sent again on the 303 GET that follows.
// ---------------------------------------------------------------------------
function extractXml(req) {
  if (typeof req.body === 'string') {
    // Raw application/xml or text/xml body (server-to-server style).
    return { xml: req.body, checksumVal: req.get('X-CheckSum-Val'), respType: req.get('X-Resp-Type') };
  }
  const f = req.body ?? {};
  let xml = f.MandateRespDoc ?? '';
  // Some integrations send the XML base64-encoded inside the field.
  if (xml && !xml.trimStart().startsWith('<')) {
    const decoded = Buffer.from(xml, 'base64').toString('utf8');
    if (decoded.trimStart().startsWith('<')) xml = decoded;
  }
  return { xml, checksumVal: f.CheckSumVal, respType: f.RespType };
}

app.post(
  '/npci/response',
  express.urlencoded({ extended: false, limit: '256kb' }),
  express.text({ type: ['application/xml', 'text/xml'], limit: '256kb' }),
  (req, res) => {
    const extracted = extractXml(req);
    const { checksumVal, respType } = extracted;
    // Browsers submit newlines inside form fields as CRLF, which would break a
    // checksum computed over LF text. XML parsers normalise to LF anyway, so do
    // the same before verifying.
    const xml = extracted.xml?.replace(/\r\n?/g, '\n');
    if (!xml) return res.redirect(303, '/mandate/response?error=MISSING_XML');

    // Checksum is computed over the exact bytes NPCI sent: verify before any parsing.
    const checksumValid = Boolean(checksumVal) && safeEqual(checksum(xml, CHECKSUM_KEY), checksumVal);

    const rid = crypto.randomBytes(24).toString('base64url');
    responses.set(rid, {
      xml,
      checksumValid,
      respType: respType ?? '',
      contentType: req.get('content-type') ?? '',
      receivedAt: Date.now(),
      consumed: false,
    });
    console.log(`[npci] response received rid=${rid.slice(0, 8)}… checksumValid=${checksumValid} type=${respType}`);

    // Post/Redirect/Get: the browser now does a plain GET of the React route.
    // Never put the XML itself in the URL (length limits, logs, Referer leaks).
    res.redirect(303, `/mandate/response?rid=${encodeURIComponent(rid)}`);
  },
);

// ---------------------------------------------------------------------------
// 3) React fetches the stored XML by its one-time id.
// ---------------------------------------------------------------------------
app.get('/api/npci/responses/:rid', (req, res) => {
  const entry = responses.get(req.params.rid);
  if (!entry) return res.status(404).json({ error: 'Response not found or expired' });
  res.set('Cache-Control', 'no-store');
  res.json({
    rid: req.params.rid,
    xml: entry.xml,
    respType: entry.respType,
    checksumValid: entry.checksumValid,
    contentType: entry.contentType,
    receivedAt: new Date(entry.receivedAt).toISOString(),
    consumed: entry.consumed,
    mandateId: entry.mandateId ?? null,
  });
});

// ---------------------------------------------------------------------------
// 4) React submits the mapped fields. The backend re-derives every field from
//    the stored raw XML and rejects the submit if the client's copy differs.
// ---------------------------------------------------------------------------
app.post('/api/mandates', express.json({ limit: '64kb' }), (req, res) => {
  const { rid, mandate } = req.body ?? {};
  const entry = responses.get(rid);
  if (!entry) return res.status(404).json({ error: 'Response not found or expired' });
  if (!entry.checksumValid) return res.status(422).json({ error: 'Checksum validation failed; response not trusted' });
  if (entry.consumed) {
    const existing = mandates.find((m) => m.id === entry.mandateId);
    return res.status(409).json({ error: 'Response already submitted', mandate: existing });
  }

  let parsed;
  try {
    parsed = parseMandateResponse(entry.xml);
  } catch (err) {
    return res.status(422).json({ error: `Unparseable XML: ${err.message}` });
  }

  const original = initiated.get(parsed.merchantMsgId);
  if (!original) return res.status(422).json({ error: 'Response does not match any mandate request we initiated' });
  if (original.mndtReqId !== parsed.mandateRequestId) {
    return res.status(422).json({ error: 'MndtReqId does not match the original request' });
  }

  const mismatches = COMPARE_KEYS.filter((k) => String(mandate?.[k] ?? '') !== String(parsed[k] ?? ''));
  if (mismatches.length) {
    return res.status(422).json({ error: 'Submitted fields do not match the NPCI response', mismatches });
  }

  const record = {
    id: crypto.randomUUID(),
    status: parsed.accepted ? 'ACTIVE' : 'REJECTED',
    ...parsed,
    savedAt: new Date().toISOString(),
  };
  mandates.unshift(record);
  entry.consumed = true;
  entry.mandateId = record.id;
  initiated.delete(parsed.merchantMsgId);
  res.status(201).json(record);
});

app.get('/api/mandates', (_req, res) => res.json(mandates));

// ---------------------------------------------------------------------------
// Production: serve the built React app from the same origin, SPA fallback.
// ---------------------------------------------------------------------------
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/|npci\/).*/, (_req, res, next) =>
  res.sendFile(path.join(dist, 'index.html'), (err) => err && next()));

app.listen(PORT, () => {
  console.log(`Merchant backend listening on http://localhost:${PORT}`);
});
