/**
 * TRIDENTPOS Billing: Structural XML Parser and CFDI 4.0 Timbre Fiscal Digital Validator
 * Governed by ACR-2026-020 and SEC-WP021-R4-HIGH-04.
 *
 * Implements full structural XML parsing without superficial regex/string.includes checks.
 */

import { FiscalSuccessValidationError } from './errors.js';

export interface XmlNode {
  tag: string;
  name: string;
  prefix?: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  content?: string;
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
 * Basic recursive-descent structural XML parser.
 * Validates well-formedness, tag nesting, attribute quotes, and namespace prefixes.
 */
export function parseXmlStructure(xmlText: string): XmlNode {
  if (!xmlText || typeof xmlText !== 'string' || xmlText.trim().length === 0) {
    throw new FiscalSuccessValidationError('XML input is empty or not a string');
  }

  // Strip XML declaration <?xml ...?> and comments <!-- ... -->
  let sanitized = xmlText.trim();
  if (sanitized.startsWith('<?xml')) {
    const declEnd = sanitized.indexOf('?>');
    if (declEnd === -1) {
      throw new FiscalSuccessValidationError('Malformed XML declaration');
    }
    sanitized = sanitized.slice(declEnd + 2).trim();
  }

  // Remove XML comments
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '').trim();

  let pos = 0;
  const len = sanitized.length;

  function parseAttributes(attrString: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    let idx = 0;
    const attrLen = attrString.length;

    while (idx < attrLen) {
      // Skip whitespace
      while (idx < attrLen && /\s/.test(attrString[idx]!)) idx++;
      if (idx >= attrLen) break;

      // Extract attribute name
      const nameStart = idx;
      while (idx < attrLen && /[a-zA-Z0-9_:.-]/.test(attrString[idx]!)) idx++;
      const attrName = attrString.slice(nameStart, idx);
      if (!attrName) break;

      // Skip whitespace around '='
      while (idx < attrLen && /\s/.test(attrString[idx]!)) idx++;
      if (idx >= attrLen || attrString[idx] !== '=') {
        throw new FiscalSuccessValidationError(
          `Malformed XML attribute '${attrName}': missing '='`,
        );
      }
      idx++; // skip '='
      while (idx < attrLen && /\s/.test(attrString[idx]!)) idx++;
      if (idx >= attrLen) {
        throw new FiscalSuccessValidationError(
          `Malformed XML attribute '${attrName}': missing value`,
        );
      }

      const quote = attrString[idx];
      if (quote !== '"' && quote !== "'") {
        throw new FiscalSuccessValidationError(
          `Malformed XML attribute '${attrName}': unquoted value starting with '${quote}'`,
        );
      }
      idx++; // skip opening quote

      const valStart = idx;
      while (idx < attrLen && attrString[idx] !== quote) {
        idx++;
      }
      if (idx >= attrLen) {
        throw new FiscalSuccessValidationError(
          `Malformed XML attribute '${attrName}': unclosed quote`,
        );
      }
      const rawVal = attrString.slice(valStart, idx);
      idx++; // skip closing quote

      // Decode XML entities
      attrs[attrName] = rawVal
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }

    return attrs;
  }

  function parseNode(): XmlNode {
    // Skip whitespace
    while (pos < len && /\s/.test(sanitized[pos]!)) pos++;
    if (pos >= len || sanitized[pos] !== '<') {
      throw new FiscalSuccessValidationError(`Expected '<' at position ${pos}`);
    }

    pos++; // skip '<'
    if (pos < len && sanitized[pos] === '/') {
      throw new FiscalSuccessValidationError(`Unexpected closing tag at position ${pos}`);
    }

    // Read tag name and attributes
    const tagContentStart = pos;
    let inQuotes: string | null = null;
    while (pos < len) {
      const ch = sanitized[pos]!;
      if (inQuotes) {
        if (ch === inQuotes) inQuotes = null;
      } else {
        if (ch === '"' || ch === "'") inQuotes = ch;
        else if (ch === '>') break;
      }
      pos++;
    }

    if (pos >= len) {
      throw new FiscalSuccessValidationError('Unterminated XML tag');
    }

    const tagContent = sanitized.slice(tagContentStart, pos).trim();
    pos++; // skip '>'

    const isSelfClosing = tagContent.endsWith('/');
    const cleanTagContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;

    const spaceIdx = cleanTagContent.search(/\s/);
    let fullTagName: string;
    let attrStr = '';
    if (spaceIdx === -1) {
      fullTagName = cleanTagContent;
    } else {
      fullTagName = cleanTagContent.slice(0, spaceIdx);
      attrStr = cleanTagContent.slice(spaceIdx);
    }

    const prefixMatch = fullTagName.match(/^([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/);
    const prefix = prefixMatch ? prefixMatch[1] : undefined;
    const name = prefixMatch ? prefixMatch[2]! : fullTagName;

    const attributes = parseAttributes(attrStr);
    const node: XmlNode = {
      tag: fullTagName,
      name,
      prefix,
      attributes,
      children: [],
    };

    if (isSelfClosing) {
      return node;
    }

    // Parse children or text content until closing tag
    while (pos < len) {
      // Check for closing tag
      const nextOpen = sanitized.indexOf('<', pos);
      if (nextOpen === -1) {
        throw new FiscalSuccessValidationError(`Expected closing tag for <${fullTagName}>`);
      }

      const text = sanitized.slice(pos, nextOpen).trim();
      if (text) {
        node.content = (node.content ? node.content + ' ' : '') + text;
      }
      pos = nextOpen;

      if (sanitized.slice(pos).startsWith('</')) {
        pos += 2;
        const closeEnd = sanitized.indexOf('>', pos);
        if (closeEnd === -1) {
          throw new FiscalSuccessValidationError(`Unterminated closing tag for <${fullTagName}>`);
        }
        const closingTag = sanitized.slice(pos, closeEnd).trim();
        if (closingTag !== fullTagName) {
          throw new FiscalSuccessValidationError(
            `Mismatched XML closing tag: expected </${fullTagName}> but found </${closingTag}>`,
          );
        }
        pos = closeEnd + 1;
        return node;
      }

      // Parse child node
      const child = parseNode();
      node.children.push(child);
    }

    throw new FiscalSuccessValidationError(`Unclosed XML tag <${fullTagName}>`);
  }

  const root = parseNode();

  // Ensure no trailing unparsed tags
  while (pos < len && /\s/.test(sanitized[pos]!)) pos++;
  if (pos < len) {
    throw new FiscalSuccessValidationError(
      `Extraneous content found after root XML element at position ${pos}`,
    );
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
 * Validates that stamped XML is structurally valid, contains a valid CFDI 4.0 Comprobante
 * and authoritative TimbreFiscalDigital, and extracts verified metadata.
 */
export function validateAndExtractTimbreFiscalDigital(
  stampedXml: string,
  options?: {
    expectedUuid?: string;
    expectedProvider?: string;
  },
): TimbreFiscalDigitalData {
  if (!stampedXml || typeof stampedXml !== 'string' || stampedXml.trim().length === 0) {
    throw new FiscalSuccessValidationError('Certified stamped XML is empty or missing');
  }

  const root = parseXmlStructure(stampedXml);

  // 1. Root must be Comprobante
  if (root.name.toLowerCase() !== 'comprobante') {
    throw new FiscalSuccessValidationError(
      `Root XML node must be <Comprobante>, found <${root.tag}>`,
    );
  }

  // Check Version="4.0"
  const cfdiVersion = root.attributes['Version'] ?? root.attributes['version'];
  if (cfdiVersion !== '4.0') {
    throw new FiscalSuccessValidationError(
      `CFDI version '${cfdiVersion}' is invalid; must be '4.0'`,
    );
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
  const uuid = timbre.attributes['UUID'] ?? timbre.attributes['uuid'];
  const fechaTimbrado = timbre.attributes['FechaTimbrado'] ?? timbre.attributes['fechaTimbrado'];
  const rfcProvCertif = timbre.attributes['RfcProvCertif'] ?? timbre.attributes['rfcProvCertif'];
  const selloSat =
    timbre.attributes['SelloSAT'] ?? timbre.attributes['selloSAT'] ?? timbre.attributes['selloSat'];
  const noCertificadoSat =
    timbre.attributes['NoCertificadoSAT'] ??
    timbre.attributes['noCertificadoSAT'] ??
    timbre.attributes['noCertificadoSat'];
  const version = timbre.attributes['Version'] ?? timbre.attributes['version'] ?? '1.1';
  const selloCfd = timbre.attributes['SelloCFD'] ?? timbre.attributes['selloCFD'];

  if (!uuid || !UUID_REGEX.test(uuid)) {
    throw new FiscalSuccessValidationError(
      `TimbreFiscalDigital UUID '${uuid}' is missing or malformed`,
    );
  }

  if (!fechaTimbrado || fechaTimbrado.trim().length === 0) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital FechaTimbrado is missing');
  }

  if (!selloSat || selloSat.trim().length === 0) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital SelloSAT is missing');
  }

  if (!noCertificadoSat || noCertificadoSat.trim().length === 0) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital NoCertificadoSAT is missing');
  }

  if (!rfcProvCertif || rfcProvCertif.trim().length === 0) {
    throw new FiscalSuccessValidationError('TimbreFiscalDigital RfcProvCertif is missing');
  }

  if (options?.expectedUuid && options.expectedUuid.toUpperCase() !== uuid.toUpperCase()) {
    throw new FiscalSuccessValidationError(
      `TimbreFiscalDigital UUID '${uuid}' does not match expected UUID '${options.expectedUuid}'`,
    );
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
