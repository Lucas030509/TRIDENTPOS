/**
 * TRIDENTPOS WP-022 CRM Customer Profiles & Loyalty Rewards Engine
 * Domain Error Hierarchy
 */

export class CrmDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrmDomainError';
  }
}

export class CustomerNotFoundError extends CrmDomainError {
  constructor(identifier: string) {
    super(`Cliente no encontrado con identificador: ${identifier}`);
    this.name = 'CustomerNotFoundError';
  }
}

export class InvalidCustomerPhoneError extends CrmDomainError {
  constructor(phone: string) {
    super(
      `El número de teléfono '${phone}' no es válido para búsqueda de identificador de llamadas (se requieren 10 dígitos).`,
    );
    this.name = 'InvalidCustomerPhoneError';
  }
}

export class InvalidCustomerRfcError extends CrmDomainError {
  constructor(rfc: string) {
    super(
      `El RFC fiscal '${rfc}' no cumple con la estructura tributaria mexicana válida (12 caracteres para moral, 13 para física).`,
    );
    this.name = 'InvalidCustomerRfcError';
  }
}

export class CreditLimitExceededError extends CrmDomainError {
  constructor(requested: string, limit: string, currentBalance: string) {
    super(
      `Límite de crédito excedido: solicitado ${requested}, saldo actual ${currentBalance}, límite ${limit} y no se permite sobregiro.`,
    );
    this.name = 'CreditLimitExceededError';
  }
}

export class LoyaltyAccountNotFoundError extends CrmDomainError {
  constructor(id: string) {
    super(`Cuenta de lealtad no encontrada: ${id}`);
    this.name = 'LoyaltyAccountNotFoundError';
  }
}

export class LoyaltyAccountInactiveError extends CrmDomainError {
  constructor(cardNumber: string) {
    super(`La tarjeta o cuenta de lealtad '${cardNumber}' se encuentra inactiva o suspendida.`);
    this.name = 'LoyaltyAccountInactiveError';
  }
}

export class InsufficientLoyaltyPointsError extends CrmDomainError {
  constructor(requested: string, available: string) {
    super(
      `Saldo insuficiente de puntos de lealtad: solicitados ${requested}, disponibles ${available}.`,
    );
    this.name = 'InsufficientLoyaltyPointsError';
  }
}

export class InsufficientRestCardBalanceError extends CrmDomainError {
  constructor(requested: string, available: string) {
    super(
      `Saldo insuficiente en monedero RestCard: cargo de ${requested}, saldo disponible ${available}.`,
    );
    this.name = 'InsufficientRestCardBalanceError';
  }
}

export class LoyaltyDoubleSpendError extends CrmDomainError {
  constructor(operationId: string) {
    super(
      `Intento de doble gasto o redención concurrente detectado para la operación: ${operationId}.`,
    );
    this.name = 'LoyaltyDoubleSpendError';
  }
}

export class PromotionNotApplicableError extends CrmDomainError {
  constructor(code: string, reason: string) {
    super(`La promoción '${code}' no es aplicable: ${reason}`);
    this.name = 'PromotionNotApplicableError';
  }
}
