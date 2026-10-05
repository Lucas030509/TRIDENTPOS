/**
 * TRIDENTPOS Billing: Structural XML Parser and CFDI 4.0 Timbre Fiscal Digital Validator
 * Governed by ACR-2026-020, SEC-WP021-R4-HIGH-04, and EAAF Lean Delivery Profile.
 *
 * Implements strict XML 1.0 compliant parsing with namespaces using saxes,
 * ensuring zero-tolerance for malformed constructs, unescaped entities, or unbound prefixes.
 */

import { SaxesParser } from 'saxes';
import { FiscalSuccessValidationError } from './errors.js';

export interface XmlNode {
  tag: string;
  name: string;
  prefix?: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  content?: string;
  namespaceUri?: string;
  orderedChildren?: Array<XmlNode | { text: string }>;
}

export interface TimbreFiscalDigitalData {
  version: string;
  uuid: string;
  fechaTimbrado: string;
  rfcProvCertif: string;
  selloCfd?: string;
  noCertificadoSat: string;
  selloSat: string;
}

/**
 * Parses XML text into a structured AST using strict XML 1.0 saxes parser.
 * Validates well-formedness, tag nesting, attribute quotes, entity encodings, and namespace bindings.
 */
export function parseXmlStructure(xmlText: string): XmlNode {
  if (!xmlText || typeof xmlText !== 'string' || xmlText.trim().length === 0) {
    throw new FiscalSuccessValidationError('XML input is empty or not a string');
  }

  if (Buffer.byteLength(xmlText, 'utf8') > 1024 * 1024) {
    throw new FiscalSuccessValidationError('XML payload exceeds maximum size limit (1MB)');
  }

  // Reject DTDs, external entity references, or forbidden processing instructions
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xmlText)) {
    throw new FiscalSuccessValidationError('Unsupported XML construct or DTD reference');
  }

  const parser = new SaxesParser({
    xmlns: true,
    position: true,
    fileName: 'cfdi.xml',
  });

  let root: XmlNode | null = null;
  const stack: XmlNode[] = [];
  let rootCount = 0;
  let parseError: Error | null = null;

  parser.on('error', (err: Error) => {
    if (!parseError) {
      parseError = err;
    }
  });

  parser.on('opentag', (tag) => {
    if (parseError) return;

    const attributes: Record<string, string> = Object.create(null);
    for (const [attrName, attrObj] of Object.entries(tag.attributes)) {
      attributes[attrName] = attrObj.value;
    }

    const node: XmlNode = {
      tag: tag.name,
      name: tag.local,
      prefix: tag.prefix ? tag.prefix : undefined,
      namespaceUri: tag.uri ? tag.uri : undefined,
      attributes,
      children: [],
      orderedChildren: [],
    };

    if (stack.length === 0) {
      rootCount++;
      if (rootCount > 1) {
        parseError = new Error('Multiple root elements detected');
        return;
      }
      root = node;
    } else {
      const parent = stack[stack.length - 1]!;
      parent.children.push(node);
      parent.orderedChildren!.push(node);
    }

    stack.push(node);
  });

  const handleText = (text: string) => {
    if (parseError || stack.length === 0) return;
    const current = stack[stack.length - 1]!;
    current.content = (current.content ? current.content : '') + text;
    const ordered = current.orderedChildren!;
    const last = ordered[ordered.length - 1];
    if (last && 'text' in last) {
      last.text += text;
    } else {
      ordered.push({ text });
    }
  };

  parser.on('text', handleText);
  parser.on('cdata', handleText);

  parser.on('closetag', () => {
    if (parseError) return;
    stack.pop();
  });

  try {
    parser.write(xmlText).close();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FiscalSuccessValidationError(`Invalid fiscal XML structure or identity: ${message}`);
  }

  if (parseError) {
    throw new FiscalSuccessValidationError(
      `Invalid fiscal XML structure or identity: ${(parseError as Error).message}`,
    );
  }

  if (!root || stack.length > 0 || rootCount !== 1) {
    throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
  }

  return root;
}

/**
 * Finds all nodes with given local name anywhere in the tree.
 */
export function findNodesByName(root: XmlNode, name: string): XmlNode[] {
  const result: XmlNode[] = [];
  function traverse(n: XmlNode) {
    if (n.name.toLowerCase() === name.toLowerCase()) {
      result.push(n);
    }
    for (const child of n.children) {
      traverse(child);
    }
  }
  traverse(root);
  return result;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Produces a canonical tree representation comparing elements, attributes, namespaces,
 * and the exact ordered sequence of children (elements and text nodes, including mixed content).
 */
function canonicalizeNode(
  node: XmlNode,
  isStamped: boolean,
  originalHadComplement: boolean,
): unknown {
  const canonicalOrdered: unknown[] = [];
  const ordered = node.orderedChildren ?? node.children;

  for (const item of ordered) {
    if ('text' in item) {
      canonicalOrdered.push(['#text', item.text]);
    } else {
      const child = item as XmlNode;
      // When canonicalizing stamped document, strip the authoritative TimbreFiscalDigital
      if (
        isStamped &&
        child.name === 'TimbreFiscalDigital' &&
        child.namespaceUri === 'http://www.sat.gob.mx/TimbreFiscalDigital'
      ) {
        continue;
      }

      // If the original document had no Complemento element and removing the TFD leaves
      // the stamped Complemento empty of element children, omit the added Complemento container.
      if (
        isStamped &&
        child.name === 'Complemento' &&
        child.namespaceUri === 'http://www.sat.gob.mx/cfd/4' &&
        !originalHadComplement
      ) {
        const nonTfdChildren = child.children.filter(
          (c) =>
            !(
              c.name === 'TimbreFiscalDigital' &&
              c.namespaceUri === 'http://www.sat.gob.mx/TimbreFiscalDigital'
            ),
        );
        if (nonTfdChildren.length === 0) {
          continue;
        }
      }

      canonicalOrdered.push(canonicalizeNode(child, isStamped, originalHadComplement));
    }
  }

  // Sort attributes deterministically by namespace URI and local name, excluding xmlns declarations
  const sortedAttributes = Object.entries(node.attributes)
    .filter(([k]) => !k.startsWith('xmlns'))
    .sort(([a], [b]) => a.localeCompare(b));

  return [node.name, node.namespaceUri ?? '', sortedAttributes, canonicalOrdered];
}

/**
 * Validates that stamped XML is structurally valid, contains a valid CFDI 4.0 Comprobante
 * and authoritative TimbreFiscalDigital, compares byte-for-byte structural fidelity against
 * expectedOriginalXml (allowing only the insertion of 1 valid TFD), and extracts verified metadata.
 */
export function validateAndExtractTimbreFiscalDigital(
  stampedXml: string,
  options?: {
    expectedUuid?: string;
    expectedProvider?: string;
    expectedOriginalXml?: string;
  },
): TimbreFiscalDigitalData {
  if (!stampedXml || typeof stampedXml !== 'string' || stampedXml.trim().length === 0) {
    throw new FiscalSuccessValidationError('Certified stamped XML is empty or missing');
  }

  const root = parseXmlStructure(stampedXml);

  // 1. Root must be Comprobante in CFDI 4.0 namespace
  if (root.name !== 'Comprobante' || root.namespaceUri !== 'http://www.sat.gob.mx/cfd/4') {
    throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
  }

  // Check Version="4.0"
  const cfdiVersion = root.attributes['Version'];
  if (cfdiVersion !== '4.0') {
    throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
  }

  // 2. Find Complemento -> TimbreFiscalDigital
  const timbreNodes = findNodesByName(root, 'TimbreFiscalDigital');
  if (timbreNodes.length === 0) {
    throw new FiscalSuccessValidationError(
      'Authoritative TimbreFiscalDigital not found in certified XML structure',
    );
  }
  if (timbreNodes.length > 1) {
    throw new FiscalSuccessValidationError(
      'Multiple TimbreFiscalDigital nodes found in certified XML structure',
    );
  }

  const timbre = timbreNodes[0]!;
  const complements = root.children.filter(
    (n) => n.name === 'Complemento' && n.namespaceUri === 'http://www.sat.gob.mx/cfd/4',
  );

  if (
    complements.length === 0 ||
    !complements.some((comp) => comp.children.includes(timbre)) ||
    timbre.name !== 'TimbreFiscalDigital' ||
    timbre.namespaceUri !== 'http://www.sat.gob.mx/TimbreFiscalDigital'
  ) {
    throw new FiscalSuccessValidationError('Invalid TFD namespace or placement');
  }

  // 3. Complete structural comparison against expectedOriginalXml
  if (options?.expectedOriginalXml) {
    const original = parseXmlStructure(options.expectedOriginalXml);
    const originalHasComplement = original.children.some(
      (c) => c.name === 'Complemento' && c.namespaceUri === 'http://www.sat.gob.mx/cfd/4',
    );

    const canonicalStamped = canonicalizeNode(root, true, originalHasComplement);
    const canonicalOriginal = canonicalizeNode(original, false, originalHasComplement);

    if (JSON.stringify(canonicalStamped) !== JSON.stringify(canonicalOriginal)) {
      throw new FiscalSuccessValidationError('Certified XML differs from submitted invoice');
    }
  }

  // 4. Validate TimbreFiscalDigital attributes
  const uuid = timbre.attributes['UUID'] ?? timbre.attributes['uuid'];
  const fechaTimbrado = timbre.attributes['FechaTimbrado'] ?? timbre.attributes['fechaTimbrado'];
  const rfcProvCertif = timbre.attributes['RfcProvCertif'] ?? timbre.attributes['rfcProvCertif'];
  const selloSat =
    timbre.attributes['SelloSAT'] ?? timbre.attributes['selloSAT'] ?? timbre.attributes['selloSat'];
  const noCertificadoSat =
    timbre.attributes['NoCertificadoSAT'] ??
    timbre.attributes['noCertificadoSAT'] ??
    timbre.attributes['noCertificadoSat'];
  const version = timbre.attributes['Version'];

  if (version !== '1.1') {
    throw new FiscalSuccessValidationError('TFD version must be 1.1');
  }

  const selloCfd = timbre.attributes['SelloCFD'] ?? timbre.attributes['selloCFD'];

  if (!uuid || !UUID_REGEX.test(uuid)) {
    throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
  }

  if (
    !fechaTimbrado ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?$/.test(fechaTimbrado) ||
    !Number.isFinite(Date.parse(fechaTimbrado))
  ) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital FechaTimbrado is missing');
  }

  if (!selloSat || !/^[A-Za-z0-9+/]+={0,2}$/.test(selloSat) || selloSat.length < 32) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital SelloSAT is missing');
  }

  if (!noCertificadoSat || !/^\d{20}$/.test(noCertificadoSat)) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital NoCertificadoSAT is missing');
  }

  if (
    !rfcProvCertif ||
    !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfcProvCertif) ||
    (options?.expectedProvider && rfcProvCertif !== options.expectedProvider)
  ) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital RfcProvCertif is missing');
  }

  if (options?.expectedUuid && options.expectedUuid.toUpperCase() !== uuid.toUpperCase()) {
    throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
  }

  return {
    version,
    uuid,
    fechaTimbrado,
    rfcProvCertif,
    selloCfd,
    noCertificadoSat,
    selloSat,
  };
}
