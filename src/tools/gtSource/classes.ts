import { lineOf, matchBracket, scrub, splitArgs, type Scrubbed } from './scrub';

// Pass two of three: find the pieces of a Java file worth parsing.
//
// Nothing here understands Java. It finds where a class header starts, where
// its body ends, and where a named method's body lives, all by matching
// brackets in the scrubbed text. That is enough to hand pass three a string
// like `8 * GTUtility.getTier(getMaxInputVoltage())` and to walk a superclass
// chain, which is everything the extractor needs.

export interface JavaClass {
  name: string;
  /** `gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace` */
  fqn: string;
  packageName: string;
  /** The simple name after `extends`, or undefined for a root */
  superName?: string;
  isAbstract: boolean;
  isInterface: boolean;
  /** Repo-relative path of the file it was found in */
  file: string;
  line: number;
  /** Scrubbed body text, brackets and all, between the outer braces */
  body: string;
  /** Index in the file where `body` starts, so positions can be reported */
  bodyAt: number;
}

export interface JavaFile {
  path: string;
  packageName: string;
  scrubbed: Scrubbed;
  classes: JavaClass[];
}

// `class Foo<T extends Bar<T>> extends Baz implements Qux {` — the generic
// parameter list has its own `extends` in it, so the header cannot be read with
// one regex. The type parameters are skipped by matching angle brackets first
const DECLARATION = /\b(class|interface|enum)\s+(\w+)/g;

const skipGenerics = (text: string, from: number): number => {
  let index = from;
  while (index < text.length && text[index] === ' ') index += 1;
  if (text[index] !== '<') return index;

  let depth = 0;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '<') depth += 1;
    else if (char === '>') {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    } else if (char === '{' || char === ';') return index;
  }
  return index;
};

/**
 * Every class, interface and enum in one file, nested ones included.
 *
 * Nested declarations are listed alongside their enclosing class rather than
 * under it: the only thing that reads this is a lookup by simple name, and GT's
 * inner classes — `MTEMegaBlastFurnace.this.mHeatingCapacity` and friends —
 * need to be findable the same way as any other.
 */
export const parseJavaFile = (path: string, source: string): JavaFile => {
  const scrubbed = scrub(source);
  const { text } = scrubbed;

  const packageMatch = /^package\s+([\w.]+);/m.exec(text);
  const packageName = packageMatch?.[1] ?? '';

  const classes: JavaClass[] = [];
  DECLARATION.lastIndex = 0;

  for (const match of text.matchAll(DECLARATION)) {
    const [, keyword, name] = match;
    if (keyword === undefined || name === undefined) continue;
    const at = match.index;

    const afterName = skipGenerics(text, at + match[0].length);
    const brace = text.indexOf('{', afterName);
    if (brace === -1) continue;
    // a `;` before the brace means this was not a declaration at all — a method
    // returning `Class<Foo>`, say
    if (text.slice(afterName, brace).includes(';')) continue;

    const end = matchBracket(text, brace);
    if (end === -1) continue;

    const header = text.slice(afterName, brace);
    const superMatch = /\bextends\s+([\w.]+)/.exec(header);
    // `abstract` sits on the same line as the keyword, ahead of it
    const lead = text.slice(Math.max(0, at - 80), at);

    classes.push({
      name,
      fqn: packageName === '' ? name : `${packageName}.${name}`,
      packageName,
      superName: superMatch?.[1]?.split('.').at(-1),
      isAbstract: /\babstract\b/.test(lead.split('\n').at(-1) ?? ''),
      isInterface: keyword === 'interface',
      file: path,
      line: lineOf(text, at),
      body: text.slice(brace + 1, end - 1),
      bodyAt: brace + 1,
    });
  }

  return { path, packageName, scrubbed, classes };
};

// ---------------------------------------------------------------------------
// method bodies
// ---------------------------------------------------------------------------

export interface MethodBody {
  /** Scrubbed text between the method's braces */
  text: string;
  /** Index of that text within the file */
  at: number;
  line: number;
}

/**
 * The body of a method declared directly in this class, by name.
 *
 * Matches on `<name> (` preceded by something that looks like a return type,
 * which is enough to tell a declaration from a call: a call is preceded by `.`,
 * `=`, `(` or `,`.
 */
export const methodBody = (
  klass: JavaClass,
  name: string,
): MethodBody | undefined => {
  const pattern = new RegExp(
    String.raw`(\W)([\w<>\[\],. ?]+?)\s+${name}\s*\(`,
    'g',
  );

  for (const match of klass.body.matchAll(pattern)) {
    const before = match[1] ?? '';
    if ('.=,('.includes(before)) continue;

    const open = klass.body.indexOf('(', match.index);
    const closed = matchBracket(klass.body, open);
    if (closed === -1) continue;

    // an interface method or an abstract one ends in `;`, with no body
    const rest = klass.body.slice(closed);
    const brace = rest.search(/\S/);
    if (brace === -1 || rest[brace] !== '{') continue;

    const start = closed + brace;
    const end = matchBracket(klass.body, start);
    if (end === -1) continue;

    return {
      text: klass.body.slice(start + 1, end - 1),
      at: klass.bodyAt + start + 1,
      line: lineOf(klass.body, match.index) + klass.line - 1,
    };
  }

  return undefined;
};

/**
 * The body of an anonymous subclass — `new ProcessingLogic() { … }`.
 *
 * The Pyrolyse Oven puts `setSpeedBonus` inside an overridden `process()` in
 * one of these rather than in the builder chain, so the whole body has to be
 * available to scan.
 */
export const anonymousBody = (
  text: string,
  typeName: string,
): string | undefined => {
  const pattern = new RegExp(String.raw`new\s+${typeName}\s*\(`, 'g');

  for (const match of text.matchAll(pattern)) {
    const open = text.indexOf('(', match.index);
    const closed = matchBracket(text, open);
    if (closed === -1) continue;

    const rest = text.slice(closed);
    const brace = rest.search(/\S/);
    if (brace === -1 || rest[brace] !== '{') continue;

    const start = closed + brace;
    const end = matchBracket(text, start);
    if (end === -1) continue;
    return text.slice(start + 1, end - 1);
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// what a body says
// ---------------------------------------------------------------------------

/** Every `return …;` in a body, as source text, outermost first */
export const returnExpressions = (body: string): string[] => {
  const found: string[] = [];
  for (const match of body.matchAll(/\breturn\b/g)) {
    const end = body.indexOf(';', match.index);
    if (end === -1) continue;
    const expression = body.slice(match.index + 'return'.length, end).trim();
    if (expression !== '') found.push(expression);
  }
  return found;
};

export interface CallSite {
  name: string;
  /** Each argument as source text */
  args: string[];
  at: number;
}

/**
 * Every `.<name>(…)` call in a body, with its arguments split.
 *
 * Builder chains are what this is for: one pass over `createProcessingLogic`
 * finds `setMaxParallel`, `setSpeedBonus` and `setEuModifier` wherever they sit
 * in the chain, and in whatever order.
 */
export const callSites = (
  body: string,
  names: Iterable<string>,
): CallSite[] => {
  const wanted = new Set(names);
  const found: CallSite[] = [];

  for (const match of body.matchAll(/([\w$]+)\s*\(/g)) {
    const name = match[1];
    if (name === undefined || !wanted.has(name)) continue;

    const open = body.indexOf('(', match.index);
    const closed = matchBracket(body, open);
    if (closed === -1) continue;

    // a declaration, not a call — `public ProcessingLogic setMaxParallel(int n)`
    const before = body.slice(Math.max(0, match.index - 40), match.index);
    if (/\b(public|protected|private)\s+[\w<>\[\], ]*$/.test(before)) continue;

    found.push({
      name,
      args: splitArgs(body.slice(open + 1, closed - 1)),
      at: match.index,
    });
  }

  return found;
};

/**
 * `static final int NAME = 42;` in a class body, folded to numbers.
 *
 * Only plain integer and decimal literals are taken. A constant defined in
 * terms of another is left out rather than half-resolved, and shows up as an
 * unresolved name if a formula uses it.
 */
export const constants = (klass: JavaClass): Record<string, number> => {
  const found: Record<string, number> = {};
  const pattern =
    /\bstatic\s+final\s+(?:int|long|float|double|short|byte)\s+(\w+)\s*=\s*(-?[\d_]+(?:\.\d+)?)[fFdDlL]?\s*;/g;

  for (const match of klass.body.matchAll(pattern)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    found[name] = Number(value.replaceAll('_', ''));
  }
  return found;
};

/**
 * Assignments to an instance field, as source text, skipping the ones that only
 * reset it.
 *
 * `checkMachine` always clears its fields before re-reading the structure, so
 * `mHeatingCapacity = 0;` appears alongside the real assignment. Dropping bare
 * literals leaves the one that says something — and when more than one is left
 * the caller declines to resolve the field at all rather than picking.
 */
export const fieldAssignments = (klass: JavaClass, name: string): string[] => {
  const pattern = new RegExp(
    String.raw`(?:^|[^\w.])(?:this\s*\.\s*)?${name}\s*=[^=]`,
    'g',
  );
  const found: string[] = [];

  for (const match of klass.body.matchAll(pattern)) {
    const equals = klass.body.indexOf('=', match.index);
    const end = klass.body.indexOf(';', equals);
    if (end === -1) continue;
    const value = klass.body.slice(equals + 1, end).trim();
    if (value === '' || /^-?[\d.]+[fFdDlL]?$/.test(value)) continue;
    found.push(value);
  }

  return found;
};
