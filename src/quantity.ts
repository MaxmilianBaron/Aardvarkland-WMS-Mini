// Quantities support six decimal places. Arithmetic uses safe integer micro-units.
export const QUANTITY_SCALE = 1_000_000;
export const MAX_QUANTITY = 1_000_000_000;

export function quantityUnits(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_QUANTITY) throw new Error('INVALID_QUANTITY');
  const scaled = value * QUANTITY_SCALE;
  const rounded = Math.round(scaled);
  const tolerance = Math.max(1e-7, Math.abs(scaled) * Number.EPSILON * 4);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > tolerance) throw new Error('INVALID_QUANTITY');
  return rounded;
}

export function normalizeQuantity(value: number): number {
  return quantityUnits(value) / QUANTITY_SCALE;
}

export function addQuantity(left: number, right: number): number {
  return normalizeQuantity((quantityUnits(left) + quantityUnits(right)) / QUANTITY_SCALE);
}

export function sumQuantities(values: number[]): number {
  const units = values.reduce((sum, value) => {
    const next = sum + quantityUnits(value);
    if (!Number.isSafeInteger(next)) throw new Error('INVALID_QUANTITY');
    return next;
  }, 0);
  return units / QUANTITY_SCALE;
}
