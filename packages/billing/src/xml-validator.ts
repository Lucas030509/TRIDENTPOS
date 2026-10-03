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
  namespaceUri?: string;
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

  if (Buffer.byteLength(xmlText, 'utf8') > 1024 * 1024 || /<!|<\?(?!xml\s)/.test(xmlText)) {
    throw new FiscalSuccessValidationError('Unsupported XML construct or size limit');
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
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
    let idx = 0;
    const attrLen = attrString.length;
    let hasSeenAttr = false;

    while (idx < attrLen) {
      // Skip whitespace
      const wsStart = idx;
      while (idx < attrLen && /\s/.test(attrString[idx]!)) idx++;
      if (idx >= attrLen) break;

      if (hasSeenAttr && idx === wsStart) {
        throw new FiscalSuccessValidationError('Missing whitespace separating XML attributes');
      }

      // Extract attribute name
      const nameStart = idx;
      while (idx < attrLen && /[a-zA-Z0-9_:.-]/.test(attrString[idx]!)) idx++;
      const attrName = attrString.slice(nameStart, idx);
      if (
        !attrName ||
        !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(attrName) ||
        Object.prototype.hasOwnProperty.call(attrs, attrName)
      ) {
        throw new FiscalSuccessValidationError('Invalid or duplicate XML attribute');
      }

      // Skip whitespace around '='
      while (idx < attrLen && /\s/.test(attrString[idx]!)) idx++;
      if (idx >= attrLen || attrString[idx] !== '=') {
        throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
      }
      idx++; // skip '='
      while (idx < attrLen && /\s/.test(attrString[idx]!)) idx++;
      if (idx >= attrLen) {
        throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
      }

      const quote = attrString[idx];
      if (quote !== '"' && quote !== "'") {
        throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
      }
      idx++; // skip opening quote

      const valStart = idx;
      while (idx < attrLen && attrString[idx] !== quote) {
        idx++;
      }
      if (idx >= attrLen) {
        throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
      }
      const rawVal = attrString.slice(valStart, idx);
      idx++; // skip closing quote
      hasSeenAttr = true;

      if (
        rawVal.includes('<') ||
        /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(rawVal)
      ) {
        throw new FiscalSuccessValidationError('Unsupported XML attribute entity');
      }
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

  function parseNode(parentNamespaces: Record<string, string> = {}, depth = 0): XmlNode {
    if (depth > 64) throw new FiscalSuccessValidationError('XML depth limit');
    // Skip whitespace
    while (pos < len && /\s/.test(sanitized[pos]!)) pos++;
    if (pos >= len || sanitized[pos] !== '<') {
      throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
    }

    pos++; // skip '<'
    if (pos < len && sanitized[pos] === '/') {
      throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
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

    if (!/^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/.test(fullTagName)) {
      throw new FiscalSuccessValidationError('Invalid XML element name');
    }
    const prefixMatch = fullTagName.match(/^([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/);
    const prefix = prefixMatch ? prefixMatch[1] : undefined;
    const name = prefixMatch ? prefixMatch[2]! : fullTagName;

    const attributes = parseAttributes(attrStr);
    const namespaces: Record<string, string> = { ...parentNamespaces };
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'xmlns') namespaces[''] = value;
      else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = value;
    }
    if (prefix && !namespaces[prefix]) throw new FiscalSuccessValidationError('Unbound XML prefix');
    const expandedAttributes = new Set<string>();
    for (const key of Object.keys(attributes)) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
      const parts = key.split(':');
      if (parts.length > 2 || (parts.length === 2 && !namespaces[parts[0]!])) {
        throw new FiscalSuccessValidationError('Invalid XML attribute namespace');
      }
      const expanded = parts.length === 2 ? `${namespaces[parts[0]!]}:${parts[1]}` : key;
      if (expandedAttributes.has(expanded))
        throw new FiscalSuccessValidationError('Duplicate expanded attribute');
      expandedAttributes.add(expanded);
    }
    const node: XmlNode = {
      tag: fullTagName,
      namespaceUri: namespaces[prefix ?? ''],
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
        throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
      }

      const text = sanitized.slice(pos, nextOpen).trim();
      if (text) {
        if (
          text.includes('<') ||
          /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(text)
        ) {
          throw new FiscalSuccessValidationError('Invalid XML text content or unescaped entity');
        }
        const decodedText = text
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
        node.content = (node.content ? node.content + ' ' : '') + decodedText;
      }
      pos = nextOpen;

      if (sanitized.slice(pos).startsWith('</')) {
        pos += 2;
        const closeEnd = sanitized.indexOf('>', pos);
        if (closeEnd === -1) {
          throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
        }
        const closingTag = sanitized.slice(pos, closeEnd).trim();
        if (closingTag !== fullTagName) {
          throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
        }
        pos = closeEnd + 1;
        return node;
      }

      // Parse child node
      const child = parseNode(namespaces, depth + 1);
      node.children.push(child);
    }

    throw new FiscalSuccessValidationError('Invalid fiscal XML structure or identity');
  }

  const root = parseNode();

  // Ensure no trailing unparsed tags
  while (pos < len && /\s/.test(sanitized[pos]!)) pos++;
  if (pos < len) {
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
 * Validates that stamped XML is structurally valid, contains a valid CFDI 4.0 Comprobante
 * and authoritative TimbreFiscalDigital, and extracts verified metadata.
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

  // 1. Root must be Comprobante
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
    complements.length !== 1 ||
    !complements[0]!.children.includes(timbre) ||
    timbre.name !== 'TimbreFiscalDigital' ||
    timbre.namespaceUri !== 'http://www.sat.gob.mx/TimbreFiscalDigital'
  ) {
    throw new FiscalSuccessValidationError('Invalid TFD namespace or placement');
  }
  if (options?.expectedOriginalXml) {
    const original = parseXmlStructure(options.expectedOriginalXml);
    const normalize = (n: XmlNode): unknown => {
      let children = n.children;
      if (n.name === 'Comprobante') {
        children = children.filter((c) => {
          if (c.name === 'Complemento') {
            const nonTfdChildren = c.children.filter(
              (tc) =>
                !(
                  tc.name === 'TimbreFiscalDigital' &&
                  tc.namespaceUri === 'http://www.sat.gob.mx/TimbreFiscalDigital'
                ),
            );
            return nonTfdChildren.length > 0;
          }
          return true;
        });
      }
      if (n.name === 'Complemento') {
        children = children.filter(
          (c) =>
            !(
              c.name === 'TimbreFiscalDigital' &&
              c.namespaceUri === 'http://www.sat.gob.mx/TimbreFiscalDigital'
            ),
        );
      }
      return [
        n.name,
        n.namespaceUri ?? '',
        Object.entries(n.attributes)
          .filter(([k]) => !k.startsWith('xmlns'))
          .sort(([a], [b]) => a.localeCompare(b)),
        n.content ?? '',
        children.map(normalize),
      ];
    };
    if (JSON.stringify(normalize(root)) !== JSON.stringify(normalize(original))) {
      throw new FiscalSuccessValidationError('Certified XML differs from submitted invoice');
    }
  }
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
  if (version !== '1.1') throw new FiscalSuccessValidationError('TFD version must be 1.1');
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
