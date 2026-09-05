/**
 * TRIDENTPOS WP-006: Pre-Persistence Recursive Redaction & PII Masking Engine
 * Reference: DATA_PROTECTION_AND_PRIVACY.md Sec 3, SECURITY_LOGGING_AND_MONITORING.md Sec 3.4
 */

export const REDACTED_MARKER = '[REDACTED]';

/**
 * Prohibited keys (normalized lowercase, without hyphens/underscores).
 */
const PROHIBITED_KEYS = new Set([
  'password',
  'pin',
  'pinhash',
  'token',
  'secret',
  'authorization',
  'creditcard',
  'cvv',
  'cvv2',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'clientsecret',
  'cardnumber',
  'pan',
]);

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^\+?[\d\s\-().]{7,25}$/;

/**
 * Canonical PII mask for email: preserves first local-part character and full domain.
 * Format: u***@domain.com
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) {
    return email;
  }
  const firstChar = email.charAt(0);
  const domain = email.slice(atIndex);
  return `${firstChar}***${domain}`;
}

/**
 * Canonical PII mask for phone number: preserves only the last 4 digits.
 * Format: ******1234
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) {
    return '******';
  }
  const last4 = digits.length <= 4 ? digits : digits.slice(-4);
  return `******${last4}`;
}

/**
 * Checks whether a property key is prohibited / sensitive under security policy.
 */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  if (PROHIBITED_KEYS.has(normalized)) {
    return true;
  }
  // Check common prefixes or suffixes like user_password, auth_token, client_secret
  for (const prohibited of ['password', 'secret', 'token', 'pinhash', 'privatekey']) {
    if (normalized.endsWith(prohibited)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a key is explicitly dedicated to email or phone PII.
 */
function isEmailKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return normalized === 'email' || normalized.endsWith('email');
}

function isPhoneKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return (
    normalized === 'phone' ||
    normalized.endsWith('phone') ||
    normalized === 'telephone' ||
    normalized === 'phonenumber' ||
    normalized === 'mobile'
  );
}

/**
 * Recursively sanitizes data structures before persistence or logging.
 * - Recursively redacts sensitive keys to '[REDACTED]'
 * - Masks email PII to 'u***@domain.com'
 * - Masks phone PII to '******1234'
 * - Does NOT mutate the input object
 * - Safe against prototype pollution and circular references
 * - Handles primitives, Date, null, undefined, arrays safely
 */
export function redactSensitiveData<T>(input: T, seen = new WeakSet<object>()): T {
  if (input === null || input === undefined) {
    return input;
  }

  // Primitives
  if (typeof input !== 'object') {
    return input;
  }

  // Prevent prototype pollution
  if (input instanceof Date) {
    return new Date(input.getTime()) as unknown as T;
  }
  if (input instanceof RegExp) {
    return new RegExp(input.source, input.flags) as unknown as T;
  }

  // Circular reference detection
  if (seen.has(input)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(input);

  // Arrays
  if (Array.isArray(input)) {
    const result: unknown[] = [];
    for (const item of input) {
      result.push(redactSensitiveData(item, seen));
    }
    return result as unknown as T;
  }

  // Plain objects
  const result: Record<string, unknown> = {};
  const entries = Object.entries(input);

  for (const [key, value] of entries) {
    // Prototype pollution guard
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    if (isSensitiveKey(key)) {
      result[key] = REDACTED_MARKER;
      continue;
    }

    if (typeof value === 'string') {
      if (isEmailKey(key) || EMAIL_REGEX.test(value)) {
        result[key] = maskEmail(value);
        continue;
      }
      if (isPhoneKey(key) || (value.replace(/\D/g, '').length >= 7 && PHONE_REGEX.test(value))) {
        result[key] = maskPhone(value);
        continue;
      }
      result[key] = value;
      continue;
    }

    result[key] = redactSensitiveData(value, seen);
  }

  return result as unknown as T;
}
