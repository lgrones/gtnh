import { describe, expect, it } from 'vitest';

import { JavaParseError, parseJava, withoutThis } from './javaExpr';

// Every expression below is copied from GregTech 5.09.51.482 rather than
// invented, so a change to the grammar is checked against what it will actually
// meet. The failing cases matter as much as the passing ones: the extractor's
// contract is that it reports what it cannot read, and that only holds if the
// parser refuses rather than improvises.

describe('what the parser accepts', () => {
  it('reads GT’s tier formula', () => {
    expect(
      parseJava('(8 * GTUtility.getTier(this.getMaxInputVoltage()))'),
    ).toEqual({
      kind: 'binary',
      op: '*',
      left: { kind: 'number', value: 8 },
      right: {
        kind: 'call',
        path: ['GTUtility', 'getTier'],
        args: [
          { kind: 'call', path: ['this', 'getMaxInputVoltage'], args: [] },
        ],
      },
    });
  });

  it('drops the float and long suffixes Java needs and we do not', () => {
    expect(parseJava('1F')).toEqual({ kind: 'number', value: 1 });
    expect(parseJava('2.2f')).toEqual({ kind: 'number', value: 2.2 });
    expect(parseJava('100L')).toEqual({ kind: 'number', value: 100 });
  });

  it('gives multiplication precedence over addition', () => {
    const node = parseJava('6 + tier * 12');
    expect(node).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'number', value: 6 },
      right: {
        kind: 'binary',
        op: '*',
        left: { kind: 'name', path: ['tier'] },
        right: { kind: 'number', value: 12 },
      },
    });
  });

  it('keeps subtraction left-associative', () => {
    const node = parseJava('10 - 3 - 2');
    expect(node).toEqual({
      kind: 'binary',
      op: '-',
      left: {
        kind: 'binary',
        op: '-',
        left: { kind: 'number', value: 10 },
        right: { kind: 'number', value: 3 },
      },
      right: { kind: 'number', value: 2 },
    });
  });

  it('tells a cast from a parenthesised name', () => {
    expect(parseJava('(int) getCoilLevel().getHeat()')).toMatchObject({
      kind: 'cast',
      type: 'int',
    });
    expect(parseJava('(tier)')).toEqual({ kind: 'name', path: ['tier'] });
  });

  it('reads a ternary with a comparison', () => {
    expect(parseJava('mode == 0 ? 1 : 8')).toMatchObject({
      kind: 'ternary',
      cond: { kind: 'binary', op: '==' },
    });
  });

  it('marks the call in the middle of a chain', () => {
    // `getFullTurbineAssemblies().size()` is a method on a call's result, not a
    // field of a dotted name, and the mapper matches on the last segment
    expect(parseJava('getFullTurbineAssemblies().size()')).toEqual({
      kind: 'call',
      path: ['getFullTurbineAssemblies', '()', 'size'],
      args: [],
    });
  });

  it('reads a qualified constant', () => {
    expect(parseJava('Configuration.Multiblocks.megaMachinesMax')).toEqual({
      kind: 'name',
      path: ['Configuration', 'Multiblocks', 'megaMachinesMax'],
    });
  });
});

describe('what the parser refuses', () => {
  // each of these really occurs, and each becomes an `unresolved` entry
  it.each([
    ['a switch expression', 'switch (mMode) { default -> 1; }'],
    ['an array index', 'tiers[2]'],
    ['a lambda', 'x -> x + 1'],
    ['a constructor', 'new Foo(1)'],
    ['trailing rubbish', '8 * tier extra'],
  ])('refuses %s', (_what, java) => {
    expect(() => parseJava(java)).toThrow(JavaParseError);
  });
});

describe('withoutThis', () => {
  it('drops a leading receiver', () => {
    expect(withoutThis(['this', 'mSize'])).toEqual(['mSize']);
  });

  it('leaves a bare `this` alone', () => {
    expect(withoutThis(['this'])).toEqual(['this']);
  });
});
