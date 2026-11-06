// lib/api/accounts.ts — client-side RPC wrappers for credit accounts
import type * as Server from "./accounts.server";
import { callRpc } from "./rpc-client";

export type { CreditAccountDetail, UpdateCreditAccountPatch } from "./accounts.server";

export function getCreditAccounts(...args: Parameters<typeof Server.getCreditAccounts>) {
  return callRpc<typeof Server.getCreditAccounts>('accounts', 'getCreditAccounts', ...args);
}

export function getCreditAccountDetail(...args: Parameters<typeof Server.getCreditAccountDetail>) {
  return callRpc<typeof Server.getCreditAccountDetail>(
    'accounts',
    'getCreditAccountDetail',
    ...args,
  );
}

export function mergeCardsIntoAccount(...args: Parameters<typeof Server.mergeCardsIntoAccount>) {
  return callRpc<typeof Server.mergeCardsIntoAccount>(
    'accounts',
    'mergeCardsIntoAccount',
    ...args,
  );
}

export function splitCardFromAccount(...args: Parameters<typeof Server.splitCardFromAccount>) {
  return callRpc<typeof Server.splitCardFromAccount>(
    'accounts',
    'splitCardFromAccount',
    ...args,
  );
}

export function updateCreditAccount(...args: Parameters<typeof Server.updateCreditAccount>) {
  return callRpc<typeof Server.updateCreditAccount>(
    'accounts',
    'updateCreditAccount',
    ...args,
  );
}
