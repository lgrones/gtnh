import { describe, expect, it } from 'vitest';

import {
  clamp,
  intDiv,
  javaInt,
  javaLong,
  log4,
  log4ceil,
  MAX_INT,
  MIN_INT,
  powInt,
  safeInt,
} from './num';

describe('narrowing a double to an integer', () => {
  // the JVM saturates instead of wrapping, so an overflowed duration pins at
  // the top rather than coming back negative
  it('saturates at the int bounds rather than wrapping', () => {
    expect(javaInt(1e30)).toBe(MAX_INT);
    expect(javaInt(-1e30)).toBe(MIN_INT);
    expect(javaInt(Infinity)).toBe(MAX_INT);
    expect(javaInt(-Infinity)).toBe(MIN_INT);
  });

  it('sends NaN to zero, as the JVM does', () => {
    expect(javaInt(NaN)).toBe(0);
    expect(javaLong(NaN)).toBe(0);
  });

  // `(int) Math.max(duration, 1)` is the last thing calculateOverclock does, so
  // a duration of 18.75 ticks is 18 in game — not 19, and not 18.75
  it('truncates toward zero, never rounds', () => {
    expect(javaInt(18.75)).toBe(18);
    expect(javaInt(-18.75)).toBe(-18);
    expect(javaLong(0.9)).toBe(0);
  });
});

describe('integer division', () => {
  // the headroom ratio is a long division before log4 ever sees it, so the
  // fraction is gone: 8,192 EU/t over a 3,119 EU/t recipe is 2, not 2.6
  it('discards the remainder', () => {
    expect(intDiv(8192, 3119)).toBe(2);
    expect(intDiv(8192, 97)).toBe(84);
  });

  // the one case where toward-zero and toward-negative-infinity disagree: a
  // machine below the recipe's heat
  it('truncates toward zero on a negative numerator', () => {
    expect(intDiv(-2100, 900)).toBe(-2);
    expect(Math.floor(-2100 / 900)).toBe(-3); // what a naive port would say
  });

  it('refuses a zero divisor, because every GT call site guards against one', () => {
    expect(() => intDiv(1, 0)).toThrow(RangeError);
  });
});

describe('log base 4', () => {
  it('is exact on every power of four the game can reach', () => {
    for (let n = 0; n <= 15; n += 1) expect(log4(4 ** n)).toBe(n);
  });

  // this is why tiersAbove is never negative: an underpowered machine divides
  // down to 0, and log4 answers 0 rather than minus infinity
  it('answers zero at and below one', () => {
    expect(log4(0)).toBe(0);
    expect(log4(1)).toBe(0);
  });

  it('floors between powers', () => {
    expect(log4(3)).toBe(0);
    expect(log4(6)).toBe(1);
    expect(log4(15)).toBe(1);
    expect(log4(84)).toBe(3);
  });

  it('ceils between powers', () => {
    expect(log4ceil(0)).toBe(0);
    expect(log4ceil(1)).toBe(0);
    expect(log4ceil(63)).toBe(3);
    expect(log4ceil(64)).toBe(3);
    expect(log4ceil(65)).toBe(4);
  });

  // log4ceil(voltage / 8) is how the non-amperage branch numbers the tiers, and
  // it has to agree with the ladder the rest of the app uses
  it('numbers the voltage tiers the way GT does', () => {
    expect(log4ceil(32 / 8)).toBe(1); // LV
    expect(log4ceil(128 / 8)).toBe(2); // MV
    expect(log4ceil(512 / 8)).toBe(3); // HV
    expect(log4ceil(524288 / 8)).toBe(8); // UV
  });
});

describe('integer powers', () => {
  it('handles a negative exponent, which a machine below recipe heat produces', () => {
    expect(powInt(0.95, -2)).toBeCloseTo(1 / 0.95 ** 2, 12);
    expect(powInt(0.95, -1)).toBeCloseTo(1 / 0.95, 12);
  });

  it('is one at the zeroth power', () => {
    expect(powInt(0.95, 0)).toBe(1);
    expect(powInt(4, 0)).toBe(1);
  });

  it('agrees with repeated multiplication', () => {
    expect(powInt(4, 3)).toBe(64);
    expect(powInt(0.95, 4)).toBeCloseTo(0.81450625, 12);
  });
});

describe('clamping', () => {
  it('bounds a value between its limits', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  // min(hi, max(val, lo)) — the upper bound is applied last, so it wins an
  // inverted range. the sub-one-tick multiplier needs that: it clamps an
  // unbounded maxOverclocks against however many tiers are available, and a
  // machine with none must come out at zero, not at the lower bound
  it('lets the upper bound win when the range is inverted', () => {
    expect(clamp(MAX_INT, 0, -1)).toBe(-1);
    expect(clamp(MAX_INT, 0, 0)).toBe(0);
  });
});

describe('saturating narrowing', () => {
  it('pins past the int range instead of wrapping', () => {
    expect(safeInt(3e9)).toBe(MAX_INT);
    expect(safeInt(3e9, 1)).toBe(MAX_INT - 1);
  });

  it('passes an in-range value through', () => {
    expect(safeInt(8)).toBe(8);
    expect(safeInt(0)).toBe(0);
  });
});
