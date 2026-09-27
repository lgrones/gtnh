import { describe, expect, it } from 'vitest';

import { displayName, isLangKey } from './lang';

const lang = new Map([
  ['gt.blockmachines.bw.biovat.name', 'Bacterial Vat'],
  ['tile.biovat.name', 'Bacterial Vat'],
  [
    'gt.blockmachines.multimachine.project.ig.miner.t1.name',
    'Space Mining Module MK-I',
  ],
]);

describe('telling a name from a translation key', () => {
  it.each(['tile.biovat.name', 'gt.blockmachines.multimachine.ig.siphon.name'])(
    'reads %s as a key',
    value => {
      expect(isLangKey(value)).toBe(true);
    },
  );

  // the reason the check is not simply "dotted and spaceless"
  it.each(['T.F.F.T', 'L.E.S.U.', 'Electric Blast Furnace', 'Volcanus'])(
    'reads %s as a name',
    value => {
      expect(isLangKey(value)).toBe(false);
    },
  );
});

describe('resolving a display name', () => {
  it('takes a literal name from the registration site', () => {
    expect(
      displayName(lang, 'multimachine.blastfurnace', 'Electric Blast Furnace'),
    ).toEqual({ name: 'Electric Blast Furnace', from: 'registration' });
  });

  it('looks up the unlocalized name when the registration passes a key', () => {
    // bartworks writes new MTEBioVat(ID, "bw.biovat", translateToLocal(…))
    expect(displayName(lang, 'bw.biovat', 'tile.biovat.name')).toEqual({
      name: 'Bacterial Vat',
      from: 'lang',
    });
  });

  it('falls back to the key itself when the unlocalized name misses', () => {
    expect(
      displayName(
        lang,
        'ProjectModuleMinerT1',
        'gt.blockmachines.multimachine.project.ig.miner.t1.name',
      ),
    ).toEqual({ name: 'Space Mining Module MK-I', from: 'lang' });
  });

  it('gives up rather than inventing one', () => {
    expect(
      displayName(lang, 'nothing.here', 'some.missing.key'),
    ).toBeUndefined();
  });
});
