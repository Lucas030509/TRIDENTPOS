/**
 * TRIDENTPOS WP-024: SEC-VAL-07 Security & CSP Policy Engine
 * Provides Content Security Policy generation, header validation, and XSS sanitization.
 */

export interface CspDirectives {
  readonly defaultSrc?: readonly string[];
  readonly scriptSrc?: readonly string[];
  readonly styleSrc?: readonly string[];
  readonly imgSrc?: readonly string[];
  readonly connectSrc?: readonly string[];
  readonly fontSrc?: readonly string[];
  readonly objectSrc?: readonly string[];
  readonly frameAncestors?: readonly string[];
  readonly baseUri?: readonly string[];
  readonly formAction?: readonly string[];
}

export const CANONICAL_BACKOFFICE_CSP: CspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind CSS runtime injected styles
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'https:'],
  fontSrc: ["'self'", 'https:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"], // Prevent clickjacking
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

/**
 * Builds standard CSP header string from directive configuration.
 */
export function buildCspHeader(directives: CspDirectives = CANONICAL_BACKOFFICE_CSP): string {
  const parts: string[] = [];

  const addDirective = (name: string, values?: readonly string[]) => {
    if (values && values.length > 0) {
      parts.push(`${name} ${values.join(' ')}`);
    }
  };

  addDirective('default-src', directives.defaultSrc);
  addDirective('script-src', directives.scriptSrc);
  addDirective('style-src', directives.styleSrc);
  addDirective('img-src', directives.imgSrc);
  addDirective('connect-src', directives.connectSrc);
  addDirective('font-src', directives.fontSrc);
  addDirective('object-src', directives.objectSrc);
  addDirective('frame-ancestors', directives.frameAncestors);
  addDirective('base-uri', directives.baseUri);
  addDirective('form-action', directives.formAction);

  return parts.join('; ');
}

export interface CspValidationReport {
  readonly isValid: boolean;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Validates CSP headers against SEC-VAL-07 enterprise security standards.
 */
export function validateCspPolicy(cspString: string): CspValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cspString || cspString.trim().length === 0) {
    return {
      isValid: false,
      warnings: [],
      errors: ['CSP string is empty or missing.'],
    };
  }

  // Check frame-ancestors 'none' to prevent clickjacking
  if (!cspString.includes("frame-ancestors 'none'")) {
    errors.push("Missing or non-strict 'frame-ancestors' directive; must be 'none'.");
  }

  // Check object-src 'none' to block Flash / Java / legacy plugins
  if (!cspString.includes("object-src 'none'")) {
    errors.push("Missing or non-strict 'object-src' directive; must be 'none'.");
  }

  // Detect dangerous wildcard script-src
  if (/script-src[^;]*\*/.test(cspString)) {
    errors.push("Dangerous wildcard '*' found in script-src.");
  }

  // Detect unsafe-eval
  if (cspString.includes("'unsafe-eval'")) {
    errors.push("Dangerous directive 'unsafe-eval' is prohibited in backoffice web.");
  }

  // Detect default-src missing
  if (!cspString.includes('default-src')) {
    warnings.push("Missing fallback 'default-src' directive.");
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Escapes characters with HTML entities to neutralize XSS in reflected text.
 */
export function escapeHtml(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitizes arbitrary user strings by stripping dangerous tags, inline javascript, and protocols.
 */
export function sanitizeUserInput(input: string): string {
  if (!input) return '';

  let sanitized = input;

  // Strip script, iframe, object, embed, svg tags and attributes
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');

  return sanitized.trim();
}
