/**
 * TRIDENTPOS Edge Host Navigation & Window Lockdown
 * Enforces default-deny on navigation and window.open per ACR-2026-009.
 */

export interface NavigationEventLike {
  preventDefault(): void;
  defaultPrevented?: boolean;
}

export interface NavigationGuardOptions {
  allowedOrigins: readonly string[];
  onViolation?: (attemptedUrl: string, reason: string) => void;
}

/**
 * Checks if a destination URL is strictly permitted by the allowed origin list.
 */
export function isAllowedNavigationUrl(url: string, allowedOrigins: readonly string[]): boolean {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    // Explicitly prohibit javascript:, data:, vbscript:, etc.
    if (
      parsed.protocol === 'javascript:' ||
      parsed.protocol === 'data:' ||
      parsed.protocol === 'vbscript:'
    ) {
      return false;
    }

    // Prohibit external internet schemes
    if (
      parsed.protocol !== 'file:' &&
      parsed.protocol !== 'app:' &&
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:'
    ) {
      return false;
    }

    for (const allowed of allowedOrigins) {
      if (allowed === 'file:' && parsed.protocol === 'file:') {
        return true;
      }
      try {
        const allowedParsed = new URL(allowed);
        if (parsed.origin === allowedParsed.origin) {
          return true;
        }
      } catch {
        if (url.startsWith(allowed)) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Creates an interceptor for Electron's 'will-navigate' and 'will-redirect' events.
 * If the destination is outside the allowed origins, it immediately prevents navigation.
 */
export function handleNavigationAttempt(
  event: NavigationEventLike,
  targetUrl: string,
  options: NavigationGuardOptions,
): boolean {
  const isAllowed = isAllowedNavigationUrl(targetUrl, options.allowedOrigins);
  if (!isAllowed) {
    event.preventDefault();
    if (options.onViolation) {
      options.onViolation(targetUrl, 'Destination URL outside authorized local origin list');
    }
    return false;
  }
  return true;
}

export interface WindowOpenDetails {
  url: string;
  frameName?: string;
}

export interface WindowOpenResponse {
  action: 'deny' | 'allow';
}

/**
 * Creates the window.open / popup handler for Electron WebContents.
 * Defaults strictly to 'deny' across all URLs.
 */
export function createWindowOpenHandler(
  onViolation?: (attemptedUrl: string) => void,
): (details: WindowOpenDetails) => WindowOpenResponse {
  return (details: WindowOpenDetails): WindowOpenResponse => {
    if (onViolation) {
      onViolation(details.url);
    }
    // Default-deny all window.open attempts
    return { action: 'deny' };
  };
}
