export function toPaise(rupees) {
  // Parse decimal money as text, not a floating-point multiplication.
  // Never silently round half-paise values or accept scientific notation.
  if (typeof rupees !== 'number' && typeof rupees !== 'string') {
    throw new Error('Amount must be a non-negative number with up to 2 decimal places');
  }
  if (typeof rupees === 'number' && !Number.isFinite(rupees)) {
    throw new Error('Amount must be a non-negative number with up to 2 decimal places');
  }
  const value = String(rupees).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Amount must be a non-negative number with up to 2 decimal places');
  }
  const [whole, decimals = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0') || '0');
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount exceeds safe financial range');
  }
  return Number(paise);
}

export function nightsBetween(checkin, checkout) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(checkin) || !pattern.test(checkout)) throw new Error('Use YYYY-MM-DD dates');
  const start = Date.parse(checkin + 'T00:00:00Z');
  const end = Date.parse(checkout + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) ||
      new Date(start).toISOString().slice(0, 10) !== checkin ||
      new Date(end).toISOString().slice(0, 10) !== checkout) throw new Error('Invalid dates');
  const nights = (end - start) / 86400000;
  if (!Number.isInteger(nights) || nights < 1) throw new Error('Checkout must be after check-in');
  return nights;
}

export function bookingTotals({ checkin, checkout, rooms_count, nightly_rate_paise, paid_paise = 0, tax_rate = 5 }) {
  const nights = nightsBetween(checkin, checkout);
  if (!Number.isInteger(rooms_count) || rooms_count < 1) throw new Error('Room count must be positive');
  if (!Number.isSafeInteger(nightly_rate_paise) || nightly_rate_paise < 0) throw new Error('Invalid nightly rate');
  if (!Number.isSafeInteger(paid_paise) || paid_paise < 0) throw new Error('Invalid payments');
  const total = nights * rooms_count * nightly_rate_paise;
  if (!Number.isSafeInteger(total)) throw new Error('Total exceeds allowed range');
  const taxable = Math.round(total * 100 / (100 + tax_rate));
  return { nights, total_paise: total, taxable_paise: taxable, gst_paise: total - taxable,
    paid_paise, due_paise: Math.max(0, total - paid_paise),
    credit_paise: Math.max(0, paid_paise - total) };
}
