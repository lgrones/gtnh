// Item throughput spans orders of magnitude — a stargate line moves millions an
// hour, a circuit assembler a few a second — so the precision follows the size
// rather than being fixed, and the column stays narrow either way.
export const formatRate = (rate: number): string => {
  const size = Math.abs(rate);

  if (size >= 100) return rate.toFixed(0);
  if (size >= 10) return rate.toFixed(1);
  if (size >= 0.01) return rate.toFixed(2);

  return rate.toExponential(1);
};

// a per-pass amount, which is usually a whole number of items but goes
// fractional once a recipe's parallels do not divide evenly
export const formatAmount = (amount: number): string =>
  Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(1);
