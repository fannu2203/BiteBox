const n = (key, fallback) => Number(process.env[key] ?? fallback);
export function quoteOrder({ subtotal, distanceKm, settings = {} }) {
  const deliveryRate = Number(settings.deliveryRatePerKm ?? n('DELIVERY_RATE_PER_KM', 10));
  const commissionRate = n('PLATFORM_COMMISSION_RATE', 0.17);
  const commissionCap = Number(settings.commissionCap ?? n('MAX_COMMISSION_RUPEES', 500));
  const riderShare = n('RIDER_COMMISSION_SHARE', 0.10);
  const distance = Math.max(0, Number(distanceKm) || 0);
  const deliveryFee = Math.round(distance * deliveryRate * 100) / 100;
  const commission = Math.min(subtotal * commissionRate, commissionCap);
  return { subtotal, distanceKm: distance, deliveryRate, deliveryFee, commissionRate, commissionCap, commission, riderBonus: commission * riderShare, total: subtotal + deliveryFee + commission };
}
