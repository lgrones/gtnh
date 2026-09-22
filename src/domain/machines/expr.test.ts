import { describe, expect, it } from 'vitest';

import { evaluate, validateExpr } from './expr';
import type { Expr, ExprEnv } from './types';

const env = (patch: Partial<ExprEnv> = {}): ExprEnv => ({
  tier: 5, // IV
  amps: 4,
  recipe: { heat: 1800, eut: 480, duration: 200 },
  params: {
    // Nichrome, as a coil parameter resolves
    coil: {
      raw: 'nichrome',
      numeric: 3601,
      props: { heat: 3601, tier: 2, index: 4 },
    },
    pipeCasing: { raw: 'tungstensteel', numeric: 4, props: { tier: 4 } },
    upgrades: { raw: 2, numeric: 2 },
    roughness: { raw: 'fine', numeric: 3 },
    plasma: { raw: true, numeric: 1 },
  },
  config: { megaMachinesMax: 256 },
  ...patch,
});

describe('the three encodings', () => {
  it('reads a bare number as a constant', () => {
    expect(evaluate(8, env())).toBe(8);
  });

  it('reads a bare string as a reference', () => {
    expect(evaluate('tier', env())).toBe(5);
    expect(evaluate('amps', env())).toBe(4);
    expect(evaluate('recipe.heat', env())).toBe(1800);
    expect(evaluate('config.megaMachinesMax', env())).toBe(256);
  });

  it('reads a single-key object as an operator', () => {
    expect(evaluate({ mul: [8, 'tier'] }, env())).toBe(40);
  });
});

describe('parameter references', () => {
  it('uses the numeric value on its own', () => {
    expect(evaluate('param.upgrades', env())).toBe(2);
  });

  // a coil offers both its heat and its tier, and different machines read
  // different ones — the EBF wants heat, the Pyrolyse Oven wants tier
  it('reaches a property of a tier-valued parameter', () => {
    expect(evaluate('param.coil.heat', env())).toBe(3601);
    expect(evaluate('param.coil.tier', env())).toBe(2);
  });
});

describe('the formulas this exists to carry', () => {
  // gtPlusPlus: 6 * GTUtility.getTier(getMaxInputVoltage())
  it('scales parallels by voltage tier', () => {
    expect(evaluate({ mul: [6, 'tier'] }, env())).toBe(30);
  });

  // MTEChemicalPlant: 2 * getPipeCasingTier()
  it('scales parallels by a structure tier', () => {
    expect(evaluate({ mul: [2, 'param.pipeCasing.tier'] }, env())).toBe(8);
  });

  // MTEElectricBlastFurnace: coilLevel.getHeat() + 100 * (tier - 2)
  it('builds the EBF heat capacity', () => {
    const heat: Expr = {
      add: ['param.coil.heat', { mul: [100, { sub: ['tier', 2] }] }],
    };
    expect(evaluate(heat, env())).toBe(3601 + 300);
  });

  // MTEAdvEBF: setSpeedBonus(1F / 2.2F), kept as a division so it reads like
  // the Java rather than as a rounded decimal
  it('keeps Volcanus speed bonus as the division it is written as', () => {
    expect(evaluate({ div: [1, 2.2] }, env())).toBeCloseTo(1 / 2.2, 12);
  });

  // MTEPyrolyseOven: setSpeedBonus(2f / (1 + coilHeat.getTier()))
  it('builds the Pyrolyse Oven speed bonus from the coil tier', () => {
    expect(
      evaluate({ div: [2, { add: [1, 'param.coil.tier'] }] }, env()),
    ).toBeCloseTo(2 / 3, 12);
  });

  // MTEPCBFactory: setEUtDiscount(Math.sqrt(upgrades == 0 ? 1 : upgrades))
  it('builds the PCB Factory EU discount', () => {
    expect(
      evaluate({ sqrt: { max: ['param.upgrades', 1] } }, env()),
    ).toBeCloseTo(Math.sqrt(2), 12);
  });

  // every bartworks mega multi reads the same pack config value
  it('reads a pack config value', () => {
    expect(evaluate('config.megaMachinesMax', env())).toBe(256);
  });
});

describe('branching', () => {
  it('looks a numeric value up by a parameter string', () => {
    const expr: Expr = {
      lookup: ['param.roughness', { rough: 1, standard: 2, fine: 4 }],
    };
    expect(evaluate(expr, env())).toBe(4);
  });

  it('falls back when the table has no entry and one was supplied', () => {
    const expr: Expr = { lookup: ['param.roughness', { rough: 1 }, 9] };
    expect(evaluate(expr, env())).toBe(9);
  });

  it('refuses a missing key when there is no fallback', () => {
    expect(() =>
      evaluate({ lookup: ['param.roughness', { rough: 1 }] }, env()),
    ).toThrow(ReferenceError);
  });

  it('chooses a branch on a parameter value', () => {
    const expr: Expr = {
      when: ['param.plasma', true, { mul: [4, 'tier'] }, 'tier'],
    };
    expect(evaluate(expr, env())).toBe(20);
    expect(
      evaluate(
        expr,
        env({
          params: { ...env().params, plasma: { raw: false, numeric: 0 } },
        }),
      ),
    ).toBe(5);
  });

  it('calls a custom formula when one is registered', () => {
    const custom = { pcbFactoryParallel: (e: ExprEnv) => e.tier * 3 };
    expect(evaluate({ custom: 'pcbFactoryParallel' }, env({ custom }))).toBe(
      15,
    );
  });
});

describe('refusing to guess', () => {
  // a formula that quietly evaluates to 0 produces a plausible wrong number,
  // which is worse than a blank one
  it('throws on an unknown reference rather than defaulting', () => {
    expect(() => evaluate('param.nonesuch', env())).toThrow(ReferenceError);
    expect(() => evaluate('nonesuch', env())).toThrow(ReferenceError);
    expect(() => evaluate('param.coil.nonesuch', env())).toThrow(
      ReferenceError,
    );
  });

  it('throws on an unknown operator', () => {
    expect(() =>
      evaluate({ frobnicate: [1] } as unknown as Expr, env()),
    ).toThrow(TypeError);
  });

  it('throws on an operator node with more than one key', () => {
    expect(() =>
      evaluate({ add: [1], mul: [2] } as unknown as Expr, env()),
    ).toThrow(TypeError);
  });

  it('throws on an unregistered custom formula', () => {
    expect(() => evaluate({ custom: 'nothingHere' }, env())).toThrow(
      ReferenceError,
    );
  });
});

describe('checking an expression without evaluating it', () => {
  const params = new Set(['coil', 'upgrades']);
  const config = new Set(['megaMachinesMax']);

  const check = (expr: unknown, custom = new Set<string>()) =>
    validateExpr(expr, params, config, custom);

  it('passes a sound expression', () => {
    expect(
      check({ add: ['param.coil.heat', { mul: [100, { sub: ['tier', 2] }] }] }),
    ).toEqual([]);
  });

  it('names an undeclared parameter', () => {
    expect(check('param.turbines')[0]).toContain(
      'undeclared parameter "turbines"',
    );
  });

  it('names an undefined config value', () => {
    expect(check('config.nonesuch')[0]).toContain('undefined config value');
  });

  it('catches an operator used with the wrong number of operands', () => {
    expect(check({ sub: [1] })[0]).toContain('expects 2 operands');
  });

  it('catches an empty lookup table', () => {
    expect(check({ lookup: ['param.coil', {}] })[0]).toContain(
      'lookup table is empty',
    );
  });

  it('catches a custom formula with no implementation', () => {
    expect(check({ custom: 'ghost' })[0]).toContain(
      'no custom formula named "ghost"',
    );
    expect(check({ custom: 'ghost' }, new Set(['ghost']))).toEqual([]);
  });

  it('reports where in the tree the problem is', () => {
    expect(check({ add: [1, 'param.ghost'] })[0]).toContain('$.add[1]');
  });
});
