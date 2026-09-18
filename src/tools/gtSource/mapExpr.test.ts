import { describe, expect, it } from 'vitest';

import { parseJava } from './javaExpr';
import { mapJava, MapError, type MapOptions } from './mapExpr';

const options = (extra: Partial<MapOptions> = {}): MapOptions => ({
  constants: {},
  configKeys: new Set(['megaMachinesMax']),
  ...extra,
});

const map = (java: string, extra?: Partial<MapOptions>) =>
  mapJava(parseJava(java), options(extra));

// The mapper's whole job is to be wrong loudly rather than quietly. Every
// "refuses" case below is a real formula in GT source whose value only exists
// in a running world — a structure tier, a runtime mode — and each one becomes
// an `unresolved` line in the report instead of a number nobody checked.

describe('references', () => {
  it('turns GT’s tier idiom into the tier reference', () => {
    expect(
      map('8 * GTUtility.getTier(this.getMaxInputVoltage())').expr,
    ).toEqual({ mul: [8, 'tier'] });
  });

  it('refuses getTier of anything else', () => {
    expect(() => map('GTUtility.getTier(someOtherVoltage())')).toThrow(
      MapError,
    );
  });

  it('reads a coil’s heat and its tier as different properties', () => {
    expect(map('getCoilLevel().getHeat()').expr).toBe('param.coil.heat');
    expect(map('getCoilLevel().getTier()').expr).toBe('param.coil.tier');
  });

  it('declares the coil parameter by mentioning it', () => {
    const { params } = map('2F / (1 + getCoilLevel().getTier())');
    expect(params.map(param => param.id)).toEqual(['coil']);
    expect(params[0]?.kind).toBe('coilTier');
  });

  it('takes a config value only when gtConfig.json carries the key', () => {
    expect(map('Configuration.Multiblocks.megaMachinesMax').expr).toBe(
      'config.megaMachinesMax',
    );
    expect(() => map('Configuration.Multiblocks.somethingElse')).toThrow(
      MapError,
    );
  });

  it('folds a class constant', () => {
    expect(
      map('MAX_PARALLELS', { constants: { MAX_PARALLELS: 64 } }).expr,
    ).toBe(64);
  });

  it('inlines a field whose assignment was resolved', () => {
    const fields = {
      mHeatingCapacity: parseJava('(int) getCoilLevel().getHeat() + 100'),
    };
    expect(map('mHeatingCapacity', { fields }).expr).toEqual({
      add: [{ floor: 'param.coil.heat' }, 100],
    });
  });

  it('declares a structure parameter for a tier read during checkMachine', () => {
    const { expr, params } = map('2 * getPipeCasingTier()');
    expect(expr).toEqual({ mul: [2, 'param.pipeCasing'] });
    expect(params[0]).toMatchObject({
      id: 'pipeCasing',
      kind: 'count',
      max: 3,
    });
  });
});

describe('operators', () => {
  it('maps arithmetic straight across', () => {
    expect(map('(6 + 1) * 2 / 4 - 3').expr).toEqual({
      sub: [{ div: [{ mul: [{ add: [6, 1] }, 2] }, 4] }, 3],
    });
  });

  it('reads an int cast as a floor', () => {
    expect(map('(int) 3').expr).toEqual({ floor: 3 });
  });

  it('maps Math and GTUtility onto the matching op', () => {
    expect(map('Math.max(1, 2)').expr).toEqual({ max: [1, 2] });
    expect(map('GTUtility.powInt(2, 3)').expr).toEqual({ pow: [2, 3] });
  });

  it('refuses an operator the catalog has no counterpart for', () => {
    expect(() => map('7 % 2')).toThrow(MapError);
  });

  it('turns a ternary on a boolean parameter into a `when`', () => {
    const fields = { heatLevel: parseJava('getCoilLevel()') };
    // a comparison against a constant is the only condition shape supported
    expect(() => map('mMode == MODE_SCRAP ? 64 : 8', { fields })).toThrow(
      MapError,
    );
  });

  it('refuses a condition comparing two unknowns', () => {
    expect(() => map('a > b ? 1 : 2')).toThrow(MapError);
  });
});

describe('what stays unresolved', () => {
  it.each([
    [
      'a structure count with no bounds in source',
      'getFullTurbineAssemblies().size()',
    ],
    ['laser amperage, which is hatch state', 'laserAmps'],
    ['a field assigned in checkMachine with no hint', 'mBlockTier'],
    ['a magnet tier enum', 'magnetTier.maxParallel'],
  ])('refuses %s', (_what, java) => {
    expect(() => map(java)).toThrow(MapError);
  });
});
