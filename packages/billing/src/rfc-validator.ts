/**
 * TRIDENTPOS Billing: RFC & Fiscal Field Validators
 * Conforms to Mexican SAT CFDI 4.0 specifications.
 */

import { InvalidPostalCodeError, InvalidRegimenFiscalError, InvalidRfcError } from './errors.js';

// Persona Moral: 3 uppercase letters/&/Ñ + 6 date digits + 3 alphanumeric homoclave (12 chars)
const RFC_MORAL_REGEX = /^[A-Z&Ñ]{3}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[A-Z\d]{3}$/;

// Persona Física: 4 uppercase letters/&/Ñ + 6 date digits + 3 alphanumeric homoclave (13 chars)
const RFC_FISICA_REGEX = /^[A-Z&Ñ]{4}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[A-Z\d]{3}$/;

const POSTAL_CODE_REGEX = /^\d{5}$/;
const REGIMEN_FISCAL_REGEX = /^\d{3}$/;

export const GENERIC_RFC_PUBLICO_GENERAL = 'XAXX010101000';
export const GENERIC_RFC_EXTRANJERO = 'XEXX010101000';

export function isMoralRfc(rfc: string): boolean {
  return RFC_MORAL_REGEX.test(rfc.trim().toUpperCase());
}

export function isFisicaRfc(rfc: string): boolean {
  return RFC_FISICA_REGEX.test(rfc.trim().toUpperCase());
}

export function isGenericRfc(rfc: string): boolean {
  const normalized = rfc.trim().toUpperCase();
  return normalized === GENERIC_RFC_PUBLICO_GENERAL || normalized === GENERIC_RFC_EXTRANJERO;
}

export function isValidRfc(rfc: string): boolean {
  if (!rfc || typeof rfc !== 'string') return false;
  const normalized = rfc.trim().toUpperCase();
  return isMoralRfc(normalized) || isFisicaRfc(normalized) || isGenericRfc(normalized);
}

export function assertValidRfc(rfc: string): void {
  if (!isValidRfc(rfc)) {
    throw new InvalidRfcError(
      `Invalid RFC format '${rfc}'. Must be a valid 12-char Persona Moral, 13-char Persona Física, or generic RFC`,
    );
  }
}

export function isValidPostalCode(cp: string): boolean {
  if (!cp || typeof cp !== 'string') return false;
  return POSTAL_CODE_REGEX.test(cp.trim());
}

export function assertValidPostalCode(cp: string): void {
  if (!isValidPostalCode(cp)) {
    throw new InvalidPostalCodeError(
      `Invalid Postal Code '${cp}'. Must be exactly 5 numeric digits`,
    );
  }
}

export function isValidRegimenFiscal(regimen: string): boolean {
  if (!regimen || typeof regimen !== 'string') return false;
  return REGIMEN_FISCAL_REGEX.test(regimen.trim());
}

export function assertValidRegimenFiscal(regimen: string): void {
  if (!isValidRegimenFiscal(regimen)) {
    throw new InvalidRegimenFiscalError(
      `Invalid Regimen Fiscal '${regimen}'. Must be a valid 3-digit SAT regimen code`,
    );
  }
}

export const validateRfc = assertValidRfc;
export const validatePostalCode = assertValidPostalCode;
export const validateRegimenFiscal = assertValidRegimenFiscal;
