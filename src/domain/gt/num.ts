// Java's integer semantics, as GregTech relies on them.
//
// Every function here exists because a JavaScript-obvious translation of the
// Java would be subtly wrong, and wrong in a way nothing would report: an
// overclock too few, a heat discount rounded the wrong way. Each one is a
// transcription of the GT (or JVM) behaviour it is named after, and each has a
// test pinning the case that made it necessary.
//
// Everything in this file is `gregtech.api.util.GTUtility` unless noted.

export const MAX_INT = 2147483647;
export const MIN_INT = -2147483648;

// narrowing a double to `int`. the JVM sends NaN to 0 and saturates at the int
// bounds rather than wrapping, which is what makes `(int) Math.max(duration, 1)`
// safe on a duration that overflowed
export const javaInt = (x: number): number => {
  if (Number.isNaN(x)) return 0;
  if (x >= MAX_INT) return MAX_INT;
  if (x <= MIN_INT) return MIN_INT;
  return Math.trunc(x);
};

// narrowing a double to `long`. JS numbers lose precision past 2^53 while a
// Java long runs to 2^63, so this is exact only below that — which every power
// figure in the game is, MAX voltage being 2^31
export const javaLong = (x: number): number => {
  if (Number.isNaN(x)) return 0;
  return Math.trunc(x);
};

// integer division: truncates toward ZERO, not toward negative infinity. the
// difference only shows on the heat lines, where a machine below the recipe's
// heat gives a negative numerator — `intDiv(-2100, 900)` is -2, `Math.floor`
// would say -3
export const intDiv = (a: number, b: number): number => {
  // Java throws ArithmeticException here. every GT call site divides by a
  // constant or by a value it has already checked, so reaching this is our bug
  if (b === 0) throw new RangeError('integer division by zero');
  return Math.trunc(javaLong(a) / javaLong(b));
};

// floor(log2(a)) for a >= 1, exactly. Java gets this from
// `63 - Long.numberOfLeadingZeros(a)`; Math.log2 is within a ULP of the truth
// at the boundaries, so the answer is corrected by comparison rather than
// trusted
const log2Floor = (a: number): number => {
  let n = Math.floor(Math.log2(a));
  if (2 ** (n + 1) <= a) n += 1;
  else if (2 ** n > a) n -= 1;
  return n;
};

// GTUtility.log4 — floor of log base 4, and 0 for anything at or below 1.
//
// note what this means where calculateOverclock uses it: the argument is an
// integer division that can come out 0 on an underpowered machine, and this
// answers 0 rather than -Infinity, so `tiersAbove` is never negative
export const log4 = (a: number): number => {
  if (a <= 1) return 0;
  return log2Floor(a) >> 1;
};

// GTUtility.log4ceil. `65 - numberOfLeadingZeros(a - 1) >> 1` in Java, which is
// `(floor(log2(a - 1)) + 2) >> 1` once the leading-zero count is unwound
export const log4ceil = (a: number): number => {
  if (a <= 1) return 0;
  return (log2Floor(a - 1) + 2) >> 1;
};

// GTUtility.powInt. a negative exponent is reachable: heatDiscounts goes
// negative when a machine is below the recipe's heat, which makes the discount
// multiplier greater than 1 and the recipe cost MORE. that is the real GT
// arithmetic; the app layer gates the state before it can be reached
export const powInt = (base: number, exp: number): number => {
  if (exp > 0) return base ** exp;
  if (exp < 0) return 1 / base ** -exp;
  return 1;
};

// GTUtility.clamp. `min(hi, max(val, lo))` — so when hi < lo, hi wins. the
// sub-one-tick multiplier depends on that: it clamps maxOverclocks between 0
// and the tiers available, and a machine with none at all must land on 0
export const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(value, lo));

// GTUtility.safeInt(long, margin) — saturating narrowing used by ParallelHelper
// so a parallel count multiplied past the int range pins at the top instead of
// wrapping negative
export const safeInt = (value: number, margin = 0): number =>
  value > MAX_INT - margin ? MAX_INT - margin : javaInt(value);
