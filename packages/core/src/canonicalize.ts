/**
 * TRIDENTPOS WP-006: RFC 8785 JSON Canonicalization Scheme (JCS)
 * Deterministic canonical serialization for SHA-256 audit hash-chaining.
 * Reference: RFC 8785 / NIST FIPS 180-4
 */

const NEEDS_SLOW_PATH = /["\\\u0000-\u001f\uD800-\uDFFF]/; // eslint-disable-line no-control-regex

function serializeString(value: string): string {
  if (value.length < 5000 && !NEEDS_SLOW_PATH.test(value)) {
    return '"' + value + '"';
  }
  // Check for lone surrogates
  const str = value as unknown as { isWellFormed?: () => boolean };
  if (typeof str.isWellFormed === 'function' && !str.isWellFormed()) {
    throw new Error('Lone surrogate is not allowed in RFC 8785 canonical JSON');
  }
  return JSON.stringify(value);
}

function serializePrimitive(value: unknown): string {
  switch (typeof value) {
    case 'number':
      if (Number.isNaN(value)) {
        throw new Error('NaN is not allowed in RFC 8785 canonical JSON');
      }
      if (!Number.isFinite(value)) {
        throw new Error('Infinity is not allowed in RFC 8785 canonical JSON');
      }
      return JSON.stringify(value);
    case 'string':
      return serializeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return value.toString();
    default:
      return JSON.stringify(value);
  }
}

/**
 * Sorts object keys strictly by UTF-16 code unit ordering per RFC 8785 §3.2.3.
 */
function sortKeys(keys: string[]): string[] {
  return keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

interface Frame {
  container: unknown[] | Record<string, unknown>;
  keys: string[] | null;
  index: number;
  first: boolean;
  wrappers: object[] | null;
}

function enterValue(
  val: unknown,
  seen: Set<object>,
): { isPrimitive: true; value: string } | { isPrimitive: false; frame: Frame } {
  let value = val;
  let wrappers: object[] | null = null;

  while (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    if (seen.has(value as object)) {
      throw new Error('Circular reference detected during RFC 8785 canonicalization');
    }
    seen.add(value as object);
    if (!wrappers) wrappers = [];
    wrappers.push(value as object);
    value = (value as { toJSON: () => unknown }).toJSON();
  }

  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    value = value.valueOf();
  }

  if (value === null || typeof value !== 'object') {
    if (wrappers) {
      for (const w of wrappers) seen.delete(w);
    }
    return { isPrimitive: true, value: serializePrimitive(value) };
  }

  if (seen.has(value as object)) {
    throw new Error('Circular reference detected during RFC 8785 canonicalization');
  }
  seen.add(value as object);

  const isArr = Array.isArray(value);
  return {
    isPrimitive: false,
    frame: {
      container: value as unknown[] | Record<string, unknown>,
      keys: isArr ? null : sortKeys(Object.keys(value)),
      index: 0,
      first: true,
      wrappers,
    },
  };
}

/**
 * Canonicalizes an arbitrary JavaScript value into deterministic RFC 8785 JSON.
 * Throws on circular references, NaN, Infinity, or unhandled lone surrogates.
 */
export function canonicalize(object: unknown): string {
  if (object === null || typeof object !== 'object') {
    return serializePrimitive(object);
  }

  const seen = new Set<object>();
  const root = enterValue(object, seen);
  if (root.isPrimitive) {
    return root.value;
  }

  let result = root.frame.keys === null ? '[' : '{';
  const stack: Frame[] = [root.frame];

  outer: while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const container = frame.container;

    if (frame.keys === null) {
      const arr = container as unknown[];
      while (frame.index < arr.length) {
        const i = frame.index++;
        if (i > 0) {
          result += ',';
        }
        const element = arr[i];
        const val =
          element === undefined || typeof element === 'symbol' || typeof element === 'function'
            ? null
            : element;
        if (val === null || typeof val !== 'object') {
          result += serializePrimitive(val);
          continue;
        }
        const child = enterValue(val, seen);
        if (child.isPrimitive) {
          result += child.value === undefined ? 'null' : child.value;
          continue;
        }
        result += child.frame.keys === null ? '[' : '{';
        stack.push(child.frame);
        continue outer;
      }
      result += ']';
    } else {
      const keys = frame.keys;
      const obj = container as Record<string, unknown>;
      while (frame.index < keys.length) {
        const key = keys[frame.index++]!;
        const val = obj[key];
        if (val === undefined || typeof val === 'symbol' || typeof val === 'function') {
          continue;
        }
        if (val === null || typeof val !== 'object') {
          if (frame.first) {
            frame.first = false;
          } else {
            result += ',';
          }
          result += serializeString(key) + ':' + serializePrimitive(val);
          continue;
        }
        const child = enterValue(val, seen);
        if (child.isPrimitive && child.value === undefined) {
          continue;
        }
        if (frame.first) {
          frame.first = false;
        } else {
          result += ',';
        }
        result += serializeString(key) + ':';
        if (child.isPrimitive) {
          result += child.value;
          continue;
        }
        result += child.frame.keys === null ? '[' : '{';
        stack.push(child.frame);
        continue outer;
      }
      result += '}';
    }

    seen.delete(container as object);
    if (frame.wrappers) {
      for (const w of frame.wrappers) seen.delete(w);
    }
    stack.pop();
  }

  return result;
}
