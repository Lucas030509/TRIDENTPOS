import fs from 'node:fs';
import path from 'node:path';

export interface StationConfig {
  code: string;
  stationType: 'POS' | 'KDS' | 'CAPTAIN' | 'MANAGER';
  name: string;
}

export interface NetworkConfig {
  host: string;
  port: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
}

export interface WindowConfig {
  width?: number;
  height?: number;
  title?: string;
}

export interface EdgeRuntimeConfig {
  version: string;
  environment: 'development' | 'staging' | 'production' | 'test';
  station: StationConfig;
  network: NetworkConfig;
  logging: LoggingConfig;
  window?: WindowConfig;
}

export class EdgeSecurityConfigError extends Error {
  constructor(message: string) {
    super(`[EDGE-SECURITY-CONFIG-VIOLATION] ${message}`);
    this.name = 'EdgeSecurityConfigError';
  }
}

/**
 * List of prohibited secret-bearing key fragments.
 * Per ACR-2026-009 Sec. 5.1, secret-bearing material MUST NEVER appear in edge-config.json.
 */
const PROHIBITED_SECRET_PATTERNS = Object.freeze([
  'password',
  'pin',
  'pinhash',
  'token',
  'jwt',
  'secret',
  'privatekey',
  'apikey',
  'keyring',
  'servicerole',
  'refreshtoken',
  'pairingsecret',
  'masterkey',
  'credential',
  'authsecret',
]);

/**
 * Recursively scans any object or array to ensure no secret-bearing or credential keys exist.
 */
export function assertNoProhibitedSecrets(data: unknown, pathPrefix = ''): void {
  if (data === null || typeof data !== 'object') {
    return;
  }

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      assertNoProhibitedSecrets(data[i], `${pathPrefix}[${i}]`);
    }
    return;
  }

  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const pattern of PROHIBITED_SECRET_PATTERNS) {
      if (normalizedKey.includes(pattern)) {
        throw new EdgeSecurityConfigError(
          `Prohibited secret-bearing key '${key}' detected at '${pathPrefix ? `${pathPrefix}.${key}` : key}'. Secrets must never be stored in edge-config.json.`,
        );
      }
    }
    assertNoProhibitedSecrets(record[key], pathPrefix ? `${pathPrefix}.${key}` : key);
  }
}

const ALLOWED_ROOT_KEYS = new Set([
  'version',
  'environment',
  'station',
  'network',
  'logging',
  'window',
  '$schema',
]);
const ALLOWED_ENVIRONMENTS = new Set(['development', 'staging', 'production', 'test']);
const ALLOWED_STATION_TYPES = new Set(['POS', 'KDS', 'CAPTAIN', 'MANAGER']);
const ALLOWED_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/**
 * Validates edge configuration against the governing security schema.
 * Enforces fail-closed semantics: any unknown or invalid field immediately throws.
 */
export function validateEdgeConfig(raw: unknown): EdgeRuntimeConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EdgeSecurityConfigError('Edge configuration must be a non-null JSON object');
  }

  // 1. Strict anti-secrets scan
  assertNoProhibitedSecrets(raw);

  const obj = raw as Record<string, unknown>;

  // 2. Fail-closed: no unrecognized root keys
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      throw new EdgeSecurityConfigError(
        `Unrecognized root configuration property '${key}' is prohibited.`,
      );
    }
  }

  // 3. Version validation
  if (typeof obj.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(obj.version)) {
    throw new EdgeSecurityConfigError(
      "Configuration 'version' must be a valid semver string (e.g. '1.0.0').",
    );
  }

  // 4. Environment validation
  if (typeof obj.environment !== 'string' || !ALLOWED_ENVIRONMENTS.has(obj.environment)) {
    throw new EdgeSecurityConfigError(
      `Configuration 'environment' must be one of: ${Array.from(ALLOWED_ENVIRONMENTS).join(', ')}.`,
    );
  }

  // 5. Station validation
  if (typeof obj.station !== 'object' || obj.station === null || Array.isArray(obj.station)) {
    throw new EdgeSecurityConfigError("Configuration 'station' must be a valid object.");
  }
  const station = obj.station as Record<string, unknown>;
  if (typeof station.code !== 'string' || station.code.trim().length === 0) {
    throw new EdgeSecurityConfigError("Station 'code' must be a non-empty string.");
  }
  if (typeof station.stationType !== 'string' || !ALLOWED_STATION_TYPES.has(station.stationType)) {
    throw new EdgeSecurityConfigError(
      `Station 'stationType' must be one of: ${Array.from(ALLOWED_STATION_TYPES).join(', ')}.`,
    );
  }
  if (typeof station.name !== 'string' || station.name.trim().length === 0) {
    throw new EdgeSecurityConfigError("Station 'name' must be a non-empty string.");
  }

  // 6. Network validation
  if (typeof obj.network !== 'object' || obj.network === null || Array.isArray(obj.network)) {
    throw new EdgeSecurityConfigError("Configuration 'network' must be a valid object.");
  }
  const network = obj.network as Record<string, unknown>;
  if (typeof network.host !== 'string' || network.host.trim().length === 0) {
    throw new EdgeSecurityConfigError("Network 'host' must be a valid non-empty string.");
  }
  if (
    typeof network.port !== 'number' ||
    !Number.isInteger(network.port) ||
    network.port < 1024 ||
    network.port > 65535
  ) {
    throw new EdgeSecurityConfigError("Network 'port' must be an integer between 1024 and 65535.");
  }

  // 7. Logging validation
  if (typeof obj.logging !== 'object' || obj.logging === null || Array.isArray(obj.logging)) {
    throw new EdgeSecurityConfigError("Configuration 'logging' must be a valid object.");
  }
  const logging = obj.logging as Record<string, unknown>;
  if (typeof logging.level !== 'string' || !ALLOWED_LOG_LEVELS.has(logging.level)) {
    throw new EdgeSecurityConfigError(
      `Logging 'level' must be one of: ${Array.from(ALLOWED_LOG_LEVELS).join(', ')}.`,
    );
  }

  // 8. Optional window validation
  let windowConfig: WindowConfig | undefined;
  if (obj.window !== undefined) {
    if (typeof obj.window !== 'object' || obj.window === null || Array.isArray(obj.window)) {
      throw new EdgeSecurityConfigError(
        "Configuration 'window' must be a valid object when provided.",
      );
    }
    const win = obj.window as Record<string, unknown>;
    if (
      win.width !== undefined &&
      (typeof win.width !== 'number' || win.width < 800 || win.width > 3840)
    ) {
      throw new EdgeSecurityConfigError("Window 'width' must be between 800 and 3840.");
    }
    if (
      win.height !== undefined &&
      (typeof win.height !== 'number' || win.height < 600 || win.height > 2160)
    ) {
      throw new EdgeSecurityConfigError("Window 'height' must be between 600 and 2160.");
    }
    if (win.title !== undefined && (typeof win.title !== 'string' || win.title.length > 100)) {
      throw new EdgeSecurityConfigError("Window 'title' must be a string up to 100 characters.");
    }
    windowConfig = {
      width: win.width as number | undefined,
      height: win.height as number | undefined,
      title: win.title as string | undefined,
    };
  }

  return {
    version: obj.version,
    environment: obj.environment as EdgeRuntimeConfig['environment'],
    station: {
      code: station.code,
      stationType: station.stationType as StationConfig['stationType'],
      name: station.name,
    },
    network: {
      host: network.host,
      port: network.port,
    },
    logging: {
      level: logging.level as LoggingConfig['level'],
    },
    ...(windowConfig ? { window: windowConfig } : {}),
  };
}

/**
 * Reads and validates an edge configuration file from disk.
 */
export function loadEdgeConfigFile(configFilePath: string): EdgeRuntimeConfig {
  const resolved = path.resolve(configFilePath);
  if (!fs.existsSync(resolved)) {
    throw new EdgeSecurityConfigError(`Configuration file does not exist at '${resolved}'`);
  }
  let parsed: unknown;
  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new EdgeSecurityConfigError(
      `Failed to parse edge configuration JSON: ${(err as Error).message}`,
    );
  }
  return validateEdgeConfig(parsed);
}
