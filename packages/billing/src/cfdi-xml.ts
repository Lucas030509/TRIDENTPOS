/**
 * TRIDENTPOS Billing: CFDI 4.0 XML Generator & Cadena Original Formatter
 * Complies with Mexican SAT CFDI 4.0 standard.
 */

import type { FiscalInvoice, FiscalInvoiceItem, EmisorFiscalConfig } from './types.js';

export interface CfdiXmlGenerationParams {
  invoice: FiscalInvoice;
  items?: FiscalInvoiceItem[];
  emisor?: EmisorFiscalConfig;
  certificateNumber?: string;
  certificateBase64?: string;
  sello?: string;
  issuedAtIso?: string;
}

export interface BuildCfdiXmlOptions {
  sello?: string;
  noCertificado?: string;
  certificado?: string;
  issuedAtIso?: string;
}

function formatCfdiMoney(val: string | undefined): string {
  if (!val) return '0.00';
  const num = parseFloat(val);
  return num.toFixed(2);
}

function escapeXml(unsafe: string | undefined | null): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the canonical Cadena Original string for CFDI 4.0 standard signing.
 */
export function buildCadenaOriginal40(
  invoice: FiscalInvoice,
  itemsOrEmpty?: FiscalInvoiceItem[],
  emisorOrEmpty?: EmisorFiscalConfig,
  certificateNumberParam?: string,
  fechaParam?: string,
): string {
  const items = itemsOrEmpty ?? invoice.items ?? [];
  const emisorRfc = emisorOrEmpty?.rfc ?? invoice.emisorRfc ?? 'XAXX010101000';
  const emisorNombre = emisorOrEmpty?.razonSocial ?? invoice.emisorNombre ?? 'PUBLICO GENERAL';
  const emisorRegimen = emisorOrEmpty?.regimenFiscal ?? invoice.emisorRegimenFiscal ?? '601';
  const emisorCp = emisorOrEmpty?.codigoPostal ?? invoice.emisorCodigoPostal ?? '06600';
  const certNumber =
    certificateNumberParam ??
    emisorOrEmpty?.certificateNumber ??
    emisorOrEmpty?.certificadoSatNumber ??
    '30001000000500003416';
  const fecha =
    fechaParam ??
    (invoice.createdAt
      ? new Date(invoice.createdAt).toISOString().substring(0, 19)
      : new Date().toISOString().substring(0, 19));

  const serie = invoice.serie ?? invoice.series ?? '';
  const folio = invoice.folio ?? '';
  const formaPago = invoice.formaPago ?? invoice.paymentWay ?? '01';
  const metodoPago = invoice.metodoPago ?? invoice.paymentMethod ?? 'PUE';
  const subtotal = invoice.subtotalAmount ?? invoice.subtotal ?? '0.0000';
  const total = invoice.totalAmount ?? '0.0000';
  const taxTotal = invoice.taxAmount ?? invoice.taxTotal ?? '0.0000';

  const receptorRfc = invoice.receptorRfc ?? invoice.customerTaxId ?? 'XAXX010101000';
  const receptorNombre = invoice.receptorNombre ?? invoice.customerName ?? 'PUBLICO EN GENERAL';
  const receptorCp = invoice.receptorCodigoPostal ?? invoice.customerPostalCode ?? '06600';
  const receptorRegimen = invoice.receptorRegimenFiscal ?? invoice.customerRegimenFiscal ?? '616';
  const usoCfdi = invoice.receptorUsoCfdi ?? invoice.cfdiUse ?? 'S01';

  const parts: string[] = [
    '4.0',
    serie,
    folio,
    fecha,
    formaPago,
    certNumber,
    formatCfdiMoney(subtotal),
    'MXN',
    formatCfdiMoney(total),
    'I', // Ingreso
    '01', // No aplica exportación
    metodoPago,
    emisorCp,
    emisorRfc,
    emisorNombre,
    emisorRegimen,
    receptorRfc,
    receptorNombre,
    receptorCp,
    receptorRegimen,
    usoCfdi,
  ];

  // Conceptos
  for (const item of items) {
    const claveProdServ = item.claveProdServ ?? item.satProductCode ?? '90101501';
    const claveUnidad = item.claveUnidad ?? item.satUnitCode ?? 'E48';
    const sku = item.sku ?? item.productCode ?? 'ITEM';
    const itemSubtotal = item.subtotalAmount ?? item.subtotal ?? '0.0000';
    const itemTax = item.taxAmount ?? '0.0000';
    const itemRate = item.taxRate ?? '0.1600';

    parts.push(
      claveProdServ,
      sku,
      formatCfdiMoney(item.quantity),
      claveUnidad,
      item.description,
      formatCfdiMoney(item.unitPrice),
      formatCfdiMoney(itemSubtotal),
      '02', // Objeto de impuesto (Sí objeto de impuesto)
      formatCfdiMoney(itemSubtotal), // Base
      '002', // IVA
      'Tasa',
      parseFloat(itemRate).toFixed(6), // TasaOCuota e.g. 0.160000
      formatCfdiMoney(itemTax),
    );
  }

  // Total Impuestos Trasladados
  const firstRate = items[0]?.taxRate ?? '0.1600';
  parts.push(
    '002', // IVA
    'Tasa',
    parseFloat(firstRate).toFixed(6),
    formatCfdiMoney(taxTotal),
    formatCfdiMoney(taxTotal),
  );

  return `||${parts.join('|')}||`;
}

export const buildCadenaOriginal = buildCadenaOriginal40;

/**
 * Generates schema-valid CFDI 4.0 XML document.
 */
export function generateCfdi40Xml(params: CfdiXmlGenerationParams): string {
  const { invoice } = params;
  const items = params.items ?? invoice.items ?? [];
  const emisorRfc = params.emisor?.rfc ?? invoice.emisorRfc ?? 'XAXX010101000';
  const emisorNombre = params.emisor?.razonSocial ?? invoice.emisorNombre ?? 'PUBLICO GENERAL';
  const emisorRegimen = params.emisor?.regimenFiscal ?? invoice.emisorRegimenFiscal ?? '601';
  const emisorCp = params.emisor?.codigoPostal ?? invoice.emisorCodigoPostal ?? '06600';
  const certificateNumber =
    params.certificateNumber ??
    params.emisor?.certificateNumber ??
    params.emisor?.certificadoSatNumber ??
    '30001000000500003416';
  const certificateBase64 =
    params.certificateBase64 ??
    params.emisor?.certificatePem ??
    params.emisor?.certificadoPem ??
    'MIIFuzCCA...';
  const sello = params.sello ?? invoice.selloEmisor ?? 'SELLO_MOCK';

  const serie = invoice.serie ?? invoice.series ?? '';
  const folio = invoice.folio ?? '';
  const formaPago = invoice.formaPago ?? invoice.paymentWay ?? '01';
  const metodoPago = invoice.metodoPago ?? invoice.paymentMethod ?? 'PUE';
  const subtotal = invoice.subtotalAmount ?? invoice.subtotal ?? '0.0000';
  const total = invoice.totalAmount ?? '0.0000';
  const taxTotal = invoice.taxAmount ?? invoice.taxTotal ?? '0.0000';

  const receptorRfc = invoice.receptorRfc ?? invoice.customerTaxId ?? 'XAXX010101000';
  const receptorNombre = invoice.receptorNombre ?? invoice.customerName ?? 'PUBLICO EN GENERAL';
  const receptorCp = invoice.receptorCodigoPostal ?? invoice.customerPostalCode ?? '06600';
  const receptorRegimen = invoice.receptorRegimenFiscal ?? invoice.customerRegimenFiscal ?? '616';
  const usoCfdi = invoice.receptorUsoCfdi ?? invoice.cfdiUse ?? 'S01';

  const fecha = (
    params.issuedAtIso
      ? new Date(params.issuedAtIso)
      : invoice.createdAt
        ? new Date(invoice.createdAt)
        : new Date()
  )
    .toISOString()
    .substring(0, 19);

  let conceptosXml = '';
  for (const item of items) {
    const claveProdServ = item.claveProdServ ?? item.satProductCode ?? '90101501';
    const claveUnidad = item.claveUnidad ?? item.satUnitCode ?? 'E48';
    const sku = item.sku ?? item.productCode ?? 'ITEM';
    const itemSubtotal = item.subtotalAmount ?? item.subtotal ?? '0.0000';
    const itemTax = item.taxAmount ?? '0.0000';
    const itemRate = item.taxRate ?? '0.1600';

    const qty = formatCfdiMoney(item.quantity);
    const unitPrice = formatCfdiMoney(item.unitPrice);
    const subtotalFmt = formatCfdiMoney(itemSubtotal);
    const taxAmountFmt = formatCfdiMoney(itemTax);
    const rate6 = parseFloat(itemRate).toFixed(6);

    conceptosXml += `    <cfdi:Concepto ClaveProdServ="${escapeXml(
      claveProdServ,
    )}" NoIdentificacion="${escapeXml(sku)}" Cantidad="${qty}" ClaveUnidad="${escapeXml(
      claveUnidad,
    )}" Descripcion="${escapeXml(item.description)}" ValorUnitario="${unitPrice}" Importe="${subtotalFmt}" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${subtotalFmt}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${rate6}" Importe="${taxAmountFmt}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>\n`;
  }

  const subtotalFormatted = formatCfdiMoney(subtotal);
  const totalFormatted = formatCfdiMoney(total);
  const taxTotalFormatted = formatCfdiMoney(taxTotal);
  const firstRate = items[0]?.taxRate ?? '0.1600';
  const rateTotal6 = parseFloat(firstRate).toFixed(6);

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="${escapeXml(
    serie,
  )}" Folio="${escapeXml(folio)}" Fecha="${fecha}" FormaPago="${escapeXml(
    formaPago,
  )}" NoCertificado="${escapeXml(certificateNumber)}" Certificado="${certificateBase64}" SubTotal="${subtotalFormatted}" Moneda="MXN" Total="${totalFormatted}" TipoDeComprobante="I" Exportacion="01" MetodoPago="${escapeXml(
    metodoPago,
  )}" LugarExpedicion="${escapeXml(emisorCp)}" Sello="${sello}">
  <cfdi:Emisor Rfc="${escapeXml(emisorRfc)}" Nombre="${escapeXml(
    emisorNombre,
  )}" RegimenFiscal="${escapeXml(emisorRegimen)}"/>
  <cfdi:Receptor Rfc="${escapeXml(receptorRfc)}" Nombre="${escapeXml(
    receptorNombre,
  )}" DomicilioFiscalReceptor="${escapeXml(receptorCp)}" RegimenFiscalReceptor="${escapeXml(
    receptorRegimen,
  )}" UsoCFDI="${escapeXml(usoCfdi)}"/>
  <cfdi:Conceptos>
${conceptosXml}  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${taxTotalFormatted}">
    <cfdi:Traslados>
      <cfdi:Traslado Base="${subtotalFormatted}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${rateTotal6}" Importe="${taxTotalFormatted}"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;
}

export function buildCfdi40Xml(invoice: FiscalInvoice, options?: BuildCfdiXmlOptions): string {
  return generateCfdi40Xml({
    invoice,
    sello: options?.sello,
    certificateNumber: options?.noCertificado,
    certificateBase64: options?.certificado,
    issuedAtIso: options?.issuedAtIso,
  });
}

export const buildCfdiXml = buildCfdi40Xml;
