// functions/api/_utils/units.js
// Base units are 'kg', 'l', 'units' (what's stored in raw_materials.qty and
// raw_material_transactions.delta). Staff can enter amounts in the smaller
// everyday sub-unit ('g'/'ml') for ease of use — this converts back to base.

const FAMILIES = {
  kg: { base: 'kg', sub: 'g', factor: 1000 },
  l: { base: 'l', sub: 'ml', factor: 1000 },
  units: { base: 'units', sub: null, factor: 1 },
};

export function allowedInputUnits(baseUnit) {
  const family = FAMILIES[baseUnit];
  if (!family) return [baseUnit];
  return family.sub ? [family.base, family.sub] : [family.base];
}

// Converts `amount` (expressed in `inputUnit`) into the material's base unit.
export function toBaseUnit(baseUnit, amount, inputUnit) {
  const family = FAMILIES[baseUnit];
  if (!family) throw new Error(`Unknown base unit "${baseUnit}"`);
  if (inputUnit === family.base) return amount;
  if (inputUnit === family.sub) return amount / family.factor;
  throw new Error(`"${inputUnit}" is not valid for a "${baseUnit}" material — use ${allowedInputUnits(baseUnit).join(' or ')}`);
}

// e.g. formatQuantity('kg', 0.35) -> "350 g", formatQuantity('kg', 2.4) -> "2.4 kg"
export function formatQuantity(baseUnit, baseAmount) {
  const family = FAMILIES[baseUnit];
  if (!family || !family.sub) return `${baseAmount} ${baseUnit}`;
  const abs = Math.abs(baseAmount);
  if (abs > 0 && abs < 1) return `${Math.round(baseAmount * family.factor)} ${family.sub}`;
  return `${baseAmount} ${baseUnit}`;
}