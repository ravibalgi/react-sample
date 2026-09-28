// XML helpers for the mock ONMAGS server.
//
// The document shapes below follow the ISO 20022-style layout ONMAGS uses
// (MndtInitnReq in, MndtAccptncRpt out) but are simplified for the demo.
// Always build your production mapping from the NPCI spec shared with you.
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export const NS = 'http://npci.org/onmags/schema';

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Mock checksum. Real ONMAGS responses are digitally signed (XML-DSig) and
// carry a SHA-256 CheckSumVal; verify both against NPCI's public certificate.
export function checksum(payload, key) {
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
});

export function parseMandateRequest(xml) {
  const doc = parser.parse(xml);
  const req = doc?.Document?.MndtInitnReq;
  if (!req) throw new Error('MandateReqDoc is not a MndtInitnReq document');
  const m = req.Mndt ?? {};
  return {
    msgId: req.GrpHdr?.MsgId,
    merchantId: req.GrpHdr?.ReqInitnPty?.Info?.Id,
    merchantName: req.GrpHdr?.ReqInitnPty?.Info?.Name,
    utilityCode: req.GrpHdr?.ReqInitnPty?.Info?.UtilCode,
    mndtReqId: m.MndtReqId,
    seqType: m.Ocrncs?.SeqTp,
    frequency: m.Ocrncs?.Frqcy,
    firstCollectionDate: m.Ocrncs?.FrstColltnDt,
    finalCollectionDate: m.Ocrncs?.FnlColltnDt,
    maxAmount: m.MaxAmt?.['#text'] ?? m.MaxAmt,
    currency: m.MaxAmt?.['@Ccy'] ?? 'INR',
    debtorName: m.Dbtr?.Nm,
    debtorAccount: m.Dbtr?.AccNo,
    debtorAccountType: m.Dbtr?.AcctType,
    debtorBankIfsc: m.DbtrAgt?.MmbId,
  };
}

function maskAccount(acc) {
  const s = String(acc ?? '');
  return s.length <= 4 ? s : 'X'.repeat(s.length - 4) + s.slice(-4);
}

export function buildMandateResponse(req, decision) {
  const now = new Date().toISOString();
  const npciMsgId = 'NPCI' + Date.now() + crypto.randomInt(1000, 9999);
  const umrn = decision.accepted
    ? 'UMRN' + req.debtorBankIfsc?.slice(0, 4) + Date.now().toString().slice(-10) + crypto.randomInt(100, 999)
    : '';
  const e = escapeXml;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${NS}">
  <MndtAccptncRpt>
    <GrpHdr>
      <MsgId>${e(npciMsgId)}</MsgId>
      <CreDtTm>${e(now)}</CreDtTm>
      <ReqInitnPty>
        <Info>
          <Id>${e(req.merchantId)}</Id>
          <Name>${e(req.merchantName)}</Name>
          <UtilCode>${e(req.utilityCode)}</UtilCode>
        </Info>
      </ReqInitnPty>
    </GrpHdr>
    <UndrlygAccptncDtls>
      <OrgnlMsgInf>
        <MsgId>${e(req.msgId)}</MsgId>
        <MsgNmId>pain.009.001.04</MsgNmId>
      </OrgnlMsgInf>
      <AccptncRslt>
        <Accptd>${decision.accepted ? 'true' : 'false'}</Accptd>
        <RjctRsn>
          <ReasonCode>${e(decision.reasonCode)}</ReasonCode>
          <ReasonDesc>${e(decision.reasonDesc)}</ReasonDesc>
          <RejectBy>${e(decision.rejectBy)}</RejectBy>
        </RjctRsn>
      </AccptncRslt>
      <OrgnlMndt>
        <OrgnlMndtInf>
          <MndtId>${e(umrn)}</MndtId>
          <MndtReqId>${e(req.mndtReqId)}</MndtReqId>
          <Ocrncs>
            <SeqTp>${e(req.seqType)}</SeqTp>
            <Frqcy>${e(req.frequency)}</Frqcy>
            <FrstColltnDt>${e(req.firstCollectionDate)}</FrstColltnDt>
            <FnlColltnDt>${e(req.finalCollectionDate)}</FnlColltnDt>
          </Ocrncs>
          <MaxAmt Ccy="${e(req.currency)}">${e(req.maxAmount)}</MaxAmt>
          <Dbtr>
            <Nm>${e(req.debtorName)}</Nm>
            <AccNo>${e(maskAccount(req.debtorAccount))}</AccNo>
            <AcctType>${e(req.debtorAccountType)}</AcctType>
          </Dbtr>
          <DbtrAgt>
            <MmbId>${e(req.debtorBankIfsc)}</MmbId>
          </DbtrAgt>
        </OrgnlMndtInf>
      </OrgnlMndt>
      <NPCI_RefMsgId>${e(npciMsgId)}</NPCI_RefMsgId>
    </UndrlygAccptncDtls>
  </MndtAccptncRpt>
</Document>`;
}
