export function toCents(amount: number): number {
  return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100) || 0
}

export function roundMoney(amount: number): number {
  return toCents(amount) / 100
}
