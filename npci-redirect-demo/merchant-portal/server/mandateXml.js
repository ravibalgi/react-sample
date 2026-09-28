// Server-side XML handling for the merchant backend.
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export const MERCHANT = {
  id: 'MERCHANT01',
  name: 'Demo Merchant Pvt Ltd',
  utilityCode: 'NACH00000000012345',
  categoryCode: 'U099',
};

export function checksum(payload, key) {
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function buildMandateRequest(input) {
  const msgId = 'MER' + Date.now() + crypto.randomInt(100, 999);
  const mndtReqId = 'MREQ' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="http://npci.org/onmags/schema">
  <MndtInitnReq>
    <GrpHdr>
      <MsgId>${esc(msgId)}</MsgId>
      <CreDtTm>${new Date().toISOString()}</CreDtTm>
      <ReqInitnPty>
        <Info>
          <Id>${esc(MERCHANT.id)}</Id>
          <CatCode>${esc(MERCHANT.categoryCode)}</CatCode>
          <UtilCode>${esc(MERCHANT.utilityCode)}</UtilCode>
          <Name>${esc(MERCHANT.name)}</Name>
        </Info>
      </ReqInitnPty>
    </GrpHdr>
    <Mndt>
      <MndtReqId>${esc(mndtReqId)}</MndtReqId>
      <Ocrncs>
        <SeqTp>RCUR</SeqTp>
        <Frqcy>${esc(input.frequency)}</Frqcy>
        <FrstColltnDt>${esc(input.firstCollectionDate)}</FrstColltnDt>
        <FnlColltnDt>${esc(input.finalCollectionDate)}</FnlColltnDt>
      </Ocrncs>
      <MaxAmt Ccy="INR">${esc(Number(input.maxAmount).toFixed(2))}</MaxAmt>
      <Dbtr>
        <Nm>${esc(input.debtorName)}</Nm>
        <AccNo>${esc(input.debtorAccount)}</AccNo>
        <AcctType>${esc(input.accountType)}</AcctType>
      </Dbtr>
      <DbtrAgt>
        <MmbId>${esc(input.ifsc)}</MmbId>
      </DbtrAgt>
    </Mndt>
  </MndtInitnReq>
</Document>`;
  return { msgId, mndtReqId, xml };
}

// fast-xml-parser never resolves DTDs / external entities, so it is not
// exposed to XXE. If your backend is Java, disable DOCTYPE on the parser.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
});

// Authoritative server-side extraction of the fields we trust and persist.
// The React app does its own mapping for display; the backend never trusts
// the client's copy and re-derives everything from the stored raw XML.
export function parseMandateResponse(xml) {
  const doc = parser.parse(xml);
  const rpt = doc?.Document?.MndtAccptncRpt;
  if (!rpt) throw new Error('Not a MndtAccptncRpt document');
  const d = rpt.UndrlygAccptncDtls ?? {};
  const inf = d.OrgnlMndt?.OrgnlMndtInf ?? {};
  const t = (v) => (v == null ? '' : String(v?.['#text'] ?? v).trim());
  return {
    npciMsgId: t(rpt.GrpHdr?.MsgId),
    createdAt: t(rpt.GrpHdr?.CreDtTm),
    merchantId: t(rpt.GrpHdr?.ReqInitnPty?.Info?.Id),
    merchantMsgId: t(d.OrgnlMsgInf?.MsgId),
    accepted: t(d.AccptncRslt?.Accptd) === 'true',
    reasonCode: t(d.AccptncRslt?.RjctRsn?.ReasonCode),
    reasonDesc: t(d.AccptncRslt?.RjctRsn?.ReasonDesc),
    rejectBy: t(d.AccptncRslt?.RjctRsn?.RejectBy),
    umrn: t(inf.MndtId),
    mandateRequestId: t(inf.MndtReqId),
    frequency: t(inf.Ocrncs?.Frqcy),
    firstCollectionDate: t(inf.Ocrncs?.FrstColltnDt),
    finalCollectionDate: t(inf.Ocrncs?.FnlColltnDt),
    maxAmount: t(inf.MaxAmt),
    currency: t(inf.MaxAmt?.['@Ccy']) || 'INR',
    debtorName: t(inf.Dbtr?.Nm),
    debtorAccountMasked: t(inf.Dbtr?.AccNo),
    debtorAccountType: t(inf.Dbtr?.AcctType),
    debtorBankIfsc: t(inf.DbtrAgt?.MmbId),
    npciRefMsgId: t(d.NPCI_RefMsgId),
  };
}
