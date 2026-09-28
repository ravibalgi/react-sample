// Browser-side parsing and field mapping of the NPCI MandateRespDoc XML.
//
// DOMParser is built into every browser; it does not fetch external entities,
// so it is safe to use on untrusted XML. Lookups go by localName so the
// default namespace (xmlns="http://npci.org/onmags/schema") does not get in
// the way of plain tag-name matching.

const RPT = ['MndtAccptncRpt'];
const DTLS = [...RPT, 'UndrlygAccptncDtls'];
const INF = [...DTLS, 'OrgnlMndt', 'OrgnlMndtInf'];

// Declarative field map: backend key -> label + path from <Document>.
// Adjust the paths here when the NPCI spec version changes.
export const FIELD_MAP = [
  { key: 'accepted', label: 'Accepted', path: [...DTLS, 'AccptncRslt', 'Accptd'], type: 'boolean' },
  { key: 'umrn', label: 'UMRN (Mandate Id)', path: [...INF, 'MndtId'] },
  { key: 'reasonCode', label: 'Reason code', path: [...DTLS, 'AccptncRslt', 'RjctRsn', 'ReasonCode'] },
  { key: 'reasonDesc', label: 'Reason description', path: [...DTLS, 'AccptncRslt', 'RjctRsn', 'ReasonDesc'] },
  { key: 'rejectBy', label: 'Rejected by', path: [...DTLS, 'AccptncRslt', 'RjctRsn', 'RejectBy'] },
  { key: 'npciMsgId', label: 'NPCI message id', path: [...RPT, 'GrpHdr', 'MsgId'] },
  { key: 'npciRefMsgId', label: 'NPCI ref msg id', path: [...DTLS, 'NPCI_RefMsgId'] },
  { key: 'createdAt', label: 'Response time', path: [...RPT, 'GrpHdr', 'CreDtTm'] },
  { key: 'merchantId', label: 'Merchant id', path: [...RPT, 'GrpHdr', 'ReqInitnPty', 'Info', 'Id'] },
  { key: 'merchantMsgId', label: 'Our request MsgId', path: [...DTLS, 'OrgnlMsgInf', 'MsgId'] },
  { key: 'mandateRequestId', label: 'Mandate request id', path: [...INF, 'MndtReqId'] },
  { key: 'frequency', label: 'Frequency', path: [...INF, 'Ocrncs', 'Frqcy'] },
  { key: 'firstCollectionDate', label: 'First collection', path: [...INF, 'Ocrncs', 'FrstColltnDt'] },
  { key: 'finalCollectionDate', label: 'Final collection', path: [...INF, 'Ocrncs', 'FnlColltnDt'] },
  { key: 'maxAmount', label: 'Max amount', path: [...INF, 'MaxAmt'] },
  { key: 'currency', label: 'Currency', path: [...INF, 'MaxAmt'], attr: 'Ccy' },
  { key: 'debtorName', label: 'Debtor name', path: [...INF, 'Dbtr', 'Nm'] },
  { key: 'debtorAccountMasked', label: 'Debtor account', path: [...INF, 'Dbtr', 'AccNo'] },
  { key: 'debtorAccountType', label: 'Account type', path: [...INF, 'Dbtr', 'AcctType'] },
  { key: 'debtorBankIfsc', label: 'Debtor bank IFSC', path: [...INF, 'DbtrAgt', 'MmbId'] },
];

function childByLocalName(el, name) {
  if (!el) return null;
  for (const c of el.children) if (c.localName === name) return c;
  return null;
}

function resolve(root, path) {
  return path.reduce((el, name) => childByLocalName(el, name), root);
}

export function parseMandateResp(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Malformed XML: ' + err.textContent.trim().split('\n')[0]);

  const root = doc.documentElement;
  if (root.localName !== 'Document' || !childByLocalName(root, 'MndtAccptncRpt')) {
    throw new Error(`Unexpected root <${root.localName}>; expected Document/MndtAccptncRpt`);
  }

  const mandate = {};
  for (const f of FIELD_MAP) {
    const el = resolve(root, f.path);
    const raw = (f.attr ? el?.getAttribute(f.attr) : el?.textContent)?.trim() ?? '';
    mandate[f.key] = f.type === 'boolean' ? raw === 'true' : raw;
  }
  return mandate;
}
