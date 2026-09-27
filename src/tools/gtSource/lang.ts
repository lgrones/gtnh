import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Display names that the registration site does not spell out.
//
// gregtech's own controllers are registered with the name as a literal, which
// is why the third argument works at all. The addons are not: bartworks writes
//
//     new MTEBioVat(BioVat.ID, "bw.biovat", translateToLocal("tile.biovat.name"))
//
// and gtnhintergalactic passes the lang key straight through. Both resolve
// against the `.lang` files, and those ship *in the source tree* — so this
// needs no game install, and a pack bump re-reads them along with the Java.

export type Lang = ReadonlyMap<string, string>;

const MACHINE_PREFIX = 'gt.blockmachines.';

const parsePlain = (text: string, into: Map<string, string>) => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const split = trimmed.indexOf('=');
    if (split === -1) continue;
    const key = trimmed.slice(0, split).trim();
    if (!into.has(key)) into.set(key, trimmed.slice(split + 1).trim());
  }
};

// GregTech.lang in a pack instance is a Forge config file, not a lang file:
// every line is `S:key=value`, sometimes with the key quoted
const parseConfig = (text: string, into: Map<string, string>) => {
  for (const line of text.split('\n')) {
    const match = /^\s*S:"?([^"=]+)"?\s*=(.*)$/.exec(line);
    const [, key, value] = match ?? [];
    if (key === undefined || value === undefined) continue;
    if (!into.has(key)) into.set(key, value.trim());
  }
};

/**
 * Every English lang entry in the checkout, plus the pack's own `GregTech.lang`
 * when `GT_LANG` points at one.
 *
 * The pack file is optional and comes second: it holds gregtech's own machine
 * names, which the registration sites already spell out, so it only ever
 * confirms what is known. Where it disagrees, the registration wins, because
 * that is what upstream says and the pack file is one install's snapshot.
 */
export const readLang = (root: string, packLang?: string): Lang => {
  const entries = new Map<string, string>();
  const assets = join(root, 'src', 'main', 'resources', 'assets');

  if (existsSync(assets))
    for (const mod of readdirSync(assets)) {
      const file = join(assets, mod, 'lang', 'en_US.lang');
      if (existsSync(file)) parsePlain(readFileSync(file, 'utf8'), entries);
    }

  if (packLang !== undefined && existsSync(packLang))
    parseConfig(readFileSync(packLang, 'utf8'), entries);

  return entries;
};

// A translation key rather than a name: dotted, no spaces, and starting with a
// lowercase letter. That last condition is the one doing the work — `T.F.F.T`
// and `L.E.S.U.` are real machine names that are also dotted and spaceless.
const LANG_KEY = /^[a-z][\w$]*(?:\.[\w$]+)+$/;

/** True for `tile.biovat.name`, false for `T.F.F.T` */
export const isLangKey = (value: string) => LANG_KEY.test(value);

/**
 * The name the game shows for a machine, given whatever the registration site
 * managed to say.
 *
 * `gt.blockmachines.<unlocalizedName>.name` is how every MetaTileEntity names
 * itself, so that is tried first for anything that is not already a plain
 * name.
 */
export const displayName = (
  lang: Lang,
  unlocalizedName: string | undefined,
  registered: string | undefined,
): { name: string; from: 'registration' | 'lang' } | undefined => {
  if (registered !== undefined && !isLangKey(registered))
    return { name: registered, from: 'registration' };

  if (unlocalizedName !== undefined) {
    const byUnlocalized = lang.get(`${MACHINE_PREFIX}${unlocalizedName}.name`);
    if (byUnlocalized !== undefined)
      return { name: byUnlocalized, from: 'lang' };
  }

  if (registered !== undefined) {
    const byKey = lang.get(registered);
    if (byKey !== undefined) return { name: byKey, from: 'lang' };
  }

  return undefined;
};
