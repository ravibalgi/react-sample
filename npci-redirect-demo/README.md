# NPCI ONMAGS response redirect → React portal (mock demo)

This folder has two mock systems:

| Folder | Port | What it is |
|---|---|---|
| `mock-npci-onmags/` | 4000 | Mock NPCI ONMAGS e-Mandate page. It accepts a mandate request, shows a bank "authorise" screen, then **redirects the browser back** to the merchant with the XML response (`MandateRespDoc`, `CheckSumVal`, `RespType`) as an auto-submitting HTML form. |
| `merchant-portal/` | 5173 (React, Vite) + 5050 (Node receiver/API) | Your portal. It receives the redirected POST, maps the XML fields in React and submits them to the backend. |

The XML layouts follow the ISO 20022-style structure ONMAGS uses (`MndtInitnReq` in, `MndtAccptncRpt` out), but they are **simplified**. Build your real field map from the NPCI spec version you were given.

## The key point: a React app cannot read a POST body

NPCI's "response redirection" is a **top-level browser form POST** to your return URL. A React SPA is only static JS loaded by that request, and JavaScript in the page **has no access to the body of the POST that loaded the page**. So something server-side must receive it first. The standard pattern is Post/Redirect/Get:

```
Browser            NPCI ONMAGS              Merchant receiver (server)         React app                Backend API
   |  auto-submit form  |                               |                           |                        |
   |------------------->| POST /onmags/sendRequest      |                           |                        |
   |   bank auth page   |                               |                           |                        |
   |<-------------------|                               |                           |                        |
   |  approve / reject  |                               |                           |                        |
   |------------------->|                               |                           |                        |
   | auto-submit form: MandateRespDoc=<xml>&CheckSumVal=..&RespType=..              |                        |
   |--------------------------------------------------->| POST /npci/response       |                        |
   |                                                    | verify checksum,          |                        |
   |                                                    | store raw XML under rid   |                        |
   |<---------------------------------------------------| 303 /mandate/response?rid=|                        |
   | GET /mandate/response?rid=...  (SPA route)                                     |                        |
   |------------------------------------------------------------------------------->| GET /api/npci/responses/:rid
   |                                                                                | DOMParser -> field map |
   |                                                                                | POST /api/mandates --->| re-parse stored XML,
   |                                                                                |                        | compare, persist
```

Why this shape:

* **The browser can't send `Content-Type: application/xml` in a redirect.** HTML forms only submit `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`. The XML arrives *inside a form field* (`MandateRespDoc`), sometimes base64-encoded. The receiver handles urlencoded, base64-in-field and raw `application/xml` / `text/xml` bodies (the last one for server-to-server callbacks).
* **Don't put the XML in the redirect URL.** URL length limits, access logs and `Referer` leak it. Store it and pass an unguessable one-time id (`rid`, 10-minute TTL).
* **The backend never trusts the React copy.** React parses and maps the XML for display and submits the mapped JSON; the backend re-parses the stored raw XML and returns 422 if any key field differs. It also checks the response belongs to a request it actually initiated (`OrgnlMsgInf/MsgId` + `MndtReqId`), and refuses a second submit of the same response with 409.

If you cannot run *any* server logic on the portal origin, the options are: route the return URL to your existing backend (Spring/.NET/etc.) and have it do the three steps above, or put a small handler in your reverse proxy / API gateway / edge function. The React side stays the same.

## Code map

| File | Role |
|---|---|
| `mock-npci-onmags/server.js` | `POST /onmags/sendRequest` (verify & show auth page), `POST /onmags/authorize` (build XML, auto-POST back to merchant) |
| `mock-npci-onmags/xml.js` | Request parsing and response XML builder |
| `merchant-portal/server/server.js` | `POST /npci/response` receiver (PRG), `GET /api/npci/responses/:rid`, `POST /api/mandates/initiate`, `POST /api/mandates`, `GET /api/mandates` |
| `merchant-portal/server/mandateXml.js` | Request XML builder and authoritative server-side response parser |
| `merchant-portal/client/src/npci/parseMandateResp.js` | Browser `DOMParser` parsing + declarative `FIELD_MAP` (XML path → backend key) |
| `merchant-portal/client/src/pages/MandateResponse.jsx` | The return route: fetch by `rid`, map, show, submit to backend |
| `merchant-portal/client/src/pages/StartMandate.jsx` | Starts the flow: gets the signed request from the backend and auto-POSTs the browser to NPCI |

## Run it

Needs Node 20+.

```bash
# terminal 1: mock NPCI
cd npci-redirect-demo/mock-npci-onmags
npm install
npm start                 # http://localhost:4000

# terminal 2: merchant portal (React dev server + Node receiver)
cd npci-redirect-demo/merchant-portal
npm install
npm run dev               # React on http://localhost:5173, API/receiver on :5050
```

Open http://localhost:5173, click **Proceed to NPCI**, approve or reject, and you land back on `/mandate/response?rid=…` with the mapped fields. Click **Submit to backend**; the saved mandates appear on the home page.

In dev, Vite proxies `/npci/*` and `/api/*` to the Node server so the NPCI POST, the 303 and the SPA all share one origin (`MERCHANT_RETURN_URL` defaults to `http://localhost:5173/npci/response`). For a production-style single process run `npm run build && npm start` and start the mock with `MERCHANT_RETURN_URL=http://localhost:5050/npci/response`.

Environment variables: `CHECKSUM_KEY` (shared by both mocks, default `demo-shared-secret`), `NPCI_URL`, `SERVER_PORT`, `PORT`, `MERCHANT_RETURN_URL`.

### Test the receiver without the UI

```bash
XML='<Document xmlns="http://npci.org/onmags/schema"><MndtAccptncRpt>...</MndtAccptncRpt></Document>'
SUM=$(printf '%s' "$XML" | openssl dgst -sha256 -hmac demo-shared-secret | awk '{print $2}')

# as NPCI's browser redirect does it (form field)
curl -i -X POST http://localhost:5173/npci/response \
  --data-urlencode "MandateRespDoc=$XML" --data-urlencode "CheckSumVal=$SUM" --data-urlencode "RespType=SUCCESS"

# raw application/xml (server-to-server style)
curl -i -X POST http://localhost:5173/npci/response \
  -H 'Content-Type: application/xml' -H "X-CheckSum-Val: $SUM" --data-binary "$XML"
```

Both answer `303 See Other` with `Location: /mandate/response?rid=…`.

## Production checklist

* **Checksum and signature.** The mock uses HMAC-SHA256 over the XML. Real ONMAGS responses are signed XML (XML-DSig) with a SHA-256 `CheckSumVal`, and may be encrypted. Verify them with NPCI's certificate on the server before trusting anything.
* **CRLF normalisation.** Browsers submit every newline inside a form field as `\r\n`. A checksum computed over LF text then fails. Both receivers here normalise `\r\n` → `\n` before verifying, which is what XML parsers do anyway. Found while testing this demo.
* **CSRF.** Exempt the return URL from CSRF-token middleware (the POST comes from NPCI's origin). Authenticity comes from the checksum/signature and from matching the response to a request you issued.
* **Cookies.** `SameSite=Lax/Strict` session cookies are **not** sent on the cross-site POST from NPCI, but they **are** sent on the 303 GET that follows. Don't rely on the session inside the POST handler; correlate on the message ids instead.
* **XXE.** Browser `DOMParser` and `fast-xml-parser` don't resolve external entities. On a Java backend, disable DOCTYPE declarations on your parser.
* **CSP.** The page that auto-posts to NPCI needs NPCI's host in `form-action`.
* **Replay and idempotency.** One-time `rid` with a TTL, consume the response once, and key persistence on UMRN / NPCI message id.
* **Storage.** The in-memory maps here are for the demo only; use Redis or your database so it works across instances.
