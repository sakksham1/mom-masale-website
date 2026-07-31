// functions/api/_utils/shipping.js
// Shared fee logic — used by checkout (authoritative) and the "Check
// Shipping" preview endpoint, so the two can never drift.
//
// Two rules, checked in order:
//   1. Small Order Fee — flat fee for carts below smallOrderThreshold,
//      REGARDLESS of pincode/zone. Always wins if it applies.
//   2. Zone-based shipping — pincode-prefix zone, waived above
//      freeShippingThreshold.

function classifyZone(pincode, zones) {
  if (zones.local.prefixes.some(p => pincode.startsWith(p))) return 'local';

  const twoDigit = parseInt(pincode.slice(0, 2), 10);
  const [lo, hi] = zones.up.prefixRange;
  if (Number.isInteger(twoDigit) && twoDigit >= lo && twoDigit <= hi) return 'up';

  return 'national';
}

// Returns { feeType, label, fee }. feeType is 'small-order' or 'shipping' —
// callers use it to decide how to label the charge to the customer.
export function resolveShipping(pincode, subtotal, settings) {
  const { shippingZones, freeShippingThreshold, smallOrderThreshold, smallOrderFee } = settings.commerce;

  if (Number.isFinite(smallOrderThreshold) && subtotal < smallOrderThreshold) {
    return {
      feeType: 'small-order',
      label: `Small Order Fee (orders under ₹${smallOrderThreshold})`,
      fee: smallOrderFee,
    };
  }

  const zoneKey = classifyZone(pincode, shippingZones);
  const zone = shippingZones[zoneKey];
  const fee = subtotal >= freeShippingThreshold ? 0 : zone.fee;
  return { feeType: 'shipping', label: 'Shipping', fee };
}