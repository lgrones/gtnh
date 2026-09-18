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
// fractional once a recipe's parallels do not divide evenly — or once a recipe
// row is itself fractional, which is how a chance-based output is written (a
// 5% bonus slag is 0.05 of it per run, on average).
//
// the precision follows the size for the same reason `formatRate`'s does: a
// fixed one decimal rounds a 5% chance away to nothing, and a fixed four prints
// float dust on the whole numbers that are still the common case.
export const formatAmount = (amount: number): string =>
  amount.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(amount)
      ? 0
      : Math.abs(amount) >= 1
        ? 2
        : 4,
  });

// seconds -> "1h 2m 3s" (drops zero leading units; "0s" when empty). Durations
// here are whole seconds of machine time, so nothing finer is ever worth showing
export const formatDuration = (totalSeconds: number): string => {
  if (totalSeconds <= 0) return '0s';
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
};
