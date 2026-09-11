// lib/api/cards.ts — client-side RPC wrappers (server: cards.server.ts).
import type * as Server from './cards.server'
import { callRpc } from './rpc-client'

export type {
  CreditCardWithProduct,
  CardDetail,
  CardDetailBill,
  CardDetailBenefit,
} from './cards.server'

export function getCardProducts() {
  return callRpc<typeof Server.getCardProducts>('cards', 'getCardProducts')
}
export function getCardHolders() {
  return callRpc<typeof Server.getCardHolders>('cards', 'getCardHolders')
}
export function getCardsByHolder(...args: Parameters<typeof Server.getCardsByHolder>) {
  return callRpc<typeof Server.getCardsByHolder>('cards', 'getCardsByHolder', ...args)
}
export function getAllCardsWithProduct() {
  return callRpc<typeof Server.getAllCardsWithProduct>('cards', 'getAllCardsWithProduct')
}
export function getCardsBasicByHolders(...args: Parameters<typeof Server.getCardsBasicByHolders>) {
  return callRpc<typeof Server.getCardsBasicByHolders>('cards', 'getCardsBasicByHolders', ...args)
}
export function getCardDetail(...args: Parameters<typeof Server.getCardDetail>) {
  return callRpc<typeof Server.getCardDetail>('cards', 'getCardDetail', ...args)
}
export function createCard(...args: Parameters<typeof Server.createCard>) {
  return callRpc<typeof Server.createCard>('cards', 'createCard', ...args)
}
export function updateCard(...args: Parameters<typeof Server.updateCard>) {
  return callRpc<typeof Server.updateCard>('cards', 'updateCard', ...args)
}
