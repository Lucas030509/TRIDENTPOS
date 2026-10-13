/**
 * TRIDENTPOS Billing: Neutral Batch Candidate Query & Grouping
 * Implements OQ-ARCH-02 neutral architectural handling (query & grouping infrastructure decoupled from trigger timing).
 */

import { addBillingScale4 } from './numerics.js';
import type {
  BatchInvoiceCandidate,
  BatchCandidateResult,
  UnclaimedFiscalTicket,
} from './types.js';

export function groupUnclaimedFoliosIntoBatchCandidate(
  organizationId: string,
  branchId: string,
  periodStart: string,
  periodEnd: string,
  unclaimedTickets: UnclaimedFiscalTicket[],
): BatchInvoiceCandidate {
  let subtotalSum = '0.0000';
  let taxTotalSum = '0.0000';
  let totalAmountSum = '0.0000';
  const folios: string[] = [];

  for (const ticket of unclaimedTickets) {
    if (!ticket.isClaimed) {
      folios.push(ticket.ticketFolio);
      subtotalSum = addBillingScale4(subtotalSum, ticket.subtotal);
      taxTotalSum = addBillingScale4(taxTotalSum, ticket.taxTotal);
      totalAmountSum = addBillingScale4(totalAmountSum, ticket.totalAmount);
    }
  }

  return {
    organizationId,
    branchId,
    periodStart,
    periodEnd,
    ticketFolios: folios,
    subtotal: subtotalSum,
    taxTotal: taxTotalSum,
    totalAmount: totalAmountSum,
  };
}

export function findUnclaimedFolios(
  unclaimedTickets: UnclaimedFiscalTicket[],
  criteria: { organizationId: string; branchId: string; startDate: string; endDate: string },
): BatchCandidateResult {
  const candidate = groupUnclaimedFoliosIntoBatchCandidate(
    criteria.organizationId,
    criteria.branchId,
    criteria.startDate,
    criteria.endDate,
    unclaimedTickets,
  );

  return {
    organizationId: candidate.organizationId,
    branchId: candidate.branchId,
    periodStart: candidate.periodStart,
    periodEnd: candidate.periodEnd,
    candidateFolios: candidate.ticketFolios,
    totalFolios: candidate.ticketFolios.length,
    subtotalAmount: candidate.subtotal,
    taxAmount: candidate.taxTotal,
    totalAmount: candidate.totalAmount,
  };
}
