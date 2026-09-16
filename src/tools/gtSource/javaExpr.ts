// Pass three, part one: a recursive-descent parser for the sliver of Java that
// GT's overclock and parallel formulas are written in.
//
// This deliberately stops well short of a Java grammar. It reads what appears
// inside `return …;` and inside a builder argument — literals, names, field
// access, calls, unary minus, the five arithmetic operators, comparisons, a
// ternary, a cast and parentheses — and nothing else. A `switch` expression, a
// lambda, an array index or a `new` all fail to parse, on purpose: the caller
// turns a parse failure into an `unresolved` entry for a human to look at, and
// that is a far better outcome than a grammar broad enough to mis-read one.
//
// The result is a Java-shaped tree. Turning it into the catalog's `Expr` is a
// separate step (`mapExpr.ts`) so that "what does this Java say" and "what does
// it mean to us" stay independently testable.

export type JavaExpr =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  /** A dotted name: `mSize`, `this.mLevel`, `Configuration.Multiblocks.max` */
  | { kind: 'name'; path: string[] }
  /** A call, with the dotted name of its target: `GTUtility.getTier(x)` */
  | { kind: 'call'; path: string[]; args: JavaExpr[] }
  | { kind: 'unary'; op: '-' | '!'; operand: JavaExpr }
  | { kind: 'binary'; op: BinaryOp; left: JavaExpr; right: JavaExpr }
  | { kind: 'ternary'; cond: JavaExpr; then: JavaExpr; otherwise: JavaExpr }
  | { kind: 'cast'; type: string; operand: JavaExpr };

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export class JavaParseError extends Error {}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'name'; value: string }
  | { type: 'punct'; value: string };

// longest first, so `<=` is never read as `<` followed by `=`
const PUNCT = [
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '(',
  ')',
  '.',
  ',',
  '?',
  ':',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
];

// Java's numeric suffixes. `1F`, `2.2f`, `100L`, `0.5d` all mean the same
// number here — JavaScript has one number type and the catalog is data, not a
// simulation of the JVM's arithmetic
const NUMBER =
  /^(?:0[xX][\da-fA-F]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)[fFdDlL]?/;
const NAME = /^[A-Za-z_$][\w$]*/;

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let rest = source;

  while (rest.length > 0) {
    const trimmed = rest.replace(/^\s+/, '');
    if (trimmed === '') break;
    rest = trimmed;

    if (rest.startsWith('"')) {
      const end = rest.indexOf('"', 1);
      if (end === -1) throw new JavaParseError(`unterminated string: ${rest}`);
      tokens.push({ type: 'string', value: rest.slice(1, end) });
      rest = rest.slice(end + 1);
      continue;
    }

    const number = NUMBER.exec(rest);
    // a leading `.` is a field access, never a decimal point, because the only
    // way to reach one is `x.y` — `.5` is not written anywhere in this source
    if (number !== null && /^[\d]/.test(rest)) {
      const text = number[0].replaceAll('_', '').replace(/[fFdDlL]$/, '');
      tokens.push({ type: 'number', value: Number(text) });
      rest = rest.slice(number[0].length);
      continue;
    }

    const name = NAME.exec(rest);
    if (name !== null) {
      tokens.push({ type: 'name', value: name[0] });
      rest = rest.slice(name[0].length);
      continue;
    }

    const punct = PUNCT.find(candidate => rest.startsWith(candidate));
    if (punct === undefined)
      throw new JavaParseError(`cannot tokenize: ${rest.slice(0, 40)}`);
    tokens.push({ type: 'punct', value: punct });
    rest = rest.slice(punct.length);
  }

  return tokens;
};

// ---------------------------------------------------------------------------
// grammar
// ---------------------------------------------------------------------------

// Java's precedence, loosest first. Each level is left-associative, which is
// the whole reason `a - b - c` and `a / b / c` come out right.
const LEVELS: BinaryOp[][] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

// the types a cast can name. Anything else in parentheses is a subexpression,
// so `(tier)` stays a name and only `(int) tier` is read as a cast
const CAST_TYPES = new Set(['int', 'long', 'float', 'double', 'short', 'byte']);

/**
 * Parse a Java expression. Throws `JavaParseError` on anything outside the
 * supported subset — the caller records that as unresolved rather than
 * guessing.
 */
export const parseJava = (source: string): JavaExpr => {
  const tokens = tokenize(source);
  let at = 0;

  const peek = (offset = 0): Token | undefined => tokens[at + offset];
  const isPunct = (value: string, offset = 0) => {
    const token = peek(offset);
    return token?.type === 'punct' && token.value === value;
  };
  const eat = (value: string) => {
    if (!isPunct(value))
      throw new JavaParseError(
        `expected "${value}" at token ${at} of: ${source.trim()}`,
      );
    at += 1;
  };

  const parseAt = (level: number): JavaExpr => {
    if (level >= LEVELS.length) return parseUnary();

    let left = parseAt(level + 1);
    for (;;) {
      const token = peek();
      if (token?.type !== 'punct') break;
      const ops: BinaryOp[] = LEVELS[level] ?? [];
      const op = ops.find(candidate => candidate === token.value);
      if (op === undefined) break;
      at += 1;
      left = { kind: 'binary', op, left, right: parseAt(level + 1) };
    }
    return left;
  };

  function parseUnary(): JavaExpr {
    if (isPunct('-')) {
      at += 1;
      return { kind: 'unary', op: '-', operand: parseUnary() };
    }
    if (isPunct('!')) {
      at += 1;
      return { kind: 'unary', op: '!', operand: parseUnary() };
    }
    // a unary `+` carries no meaning; drop it
    if (isPunct('+')) {
      at += 1;
      return parseUnary();
    }
    return parsePostfix();
  }

  // a dotted chain, where any link may be a call: `a.b().c(1).d`
  function parsePostfix(): JavaExpr {
    let node = parsePrimary();

    while (isPunct('.')) {
      const member = peek(1);
      if (member?.type !== 'name')
        throw new JavaParseError(
          `expected a field name after "." in ${source}`,
        );
      at += 2;

      // a chain only stays a plain dotted name while every link is a plain
      // name; once a call appears the tail is a method on its result, which
      // the mapper matches by its last segment
      const base =
        node.kind === 'name'
          ? node.path
          : node.kind === 'call'
            ? [...node.path, '()']
            : ['?'];
      const path = [...base, member.value];

      node = isPunct('(')
        ? { kind: 'call', path, args: parseArgs() }
        : { kind: 'name', path };
    }

    return node;
  }

  function parseArgs(): JavaExpr[] {
    eat('(');
    const args: JavaExpr[] = [];
    if (!isPunct(')')) {
      args.push(parseTernary());
      while (isPunct(',')) {
        at += 1;
        args.push(parseTernary());
      }
    }
    eat(')');
    return args;
  }

  function parsePrimary(): JavaExpr {
    const token = peek();
    if (token === undefined)
      throw new JavaParseError(`expression ended early: ${source.trim()}`);

    if (token.type === 'number') {
      at += 1;
      return { kind: 'number', value: token.value };
    }
    if (token.type === 'string') {
      at += 1;
      return { kind: 'string', value: token.value };
    }

    if (token.type === 'name') {
      at += 1;
      if (token.value === 'true' || token.value === 'false')
        return { kind: 'boolean', value: token.value === 'true' };
      if (isPunct('('))
        return { kind: 'call', path: [token.value], args: parseArgs() };
      return { kind: 'name', path: [token.value] };
    }

    if (token.value === '(') {
      const inner = peek(1);
      if (
        inner?.type === 'name' &&
        CAST_TYPES.has(inner.value) &&
        isPunct(')', 2)
      ) {
        at += 3;
        return { kind: 'cast', type: inner.value, operand: parseUnary() };
      }
      at += 1;
      const node = parseTernary();
      eat(')');
      return node;
    }

    throw new JavaParseError(
      `unexpected "${token.value}" in: ${source.trim()}`,
    );
  }

  function parseTernary(): JavaExpr {
    const cond = parseAt(0);
    if (!isPunct('?')) return cond;
    at += 1;
    const then = parseTernary();
    eat(':');
    return { kind: 'ternary', cond, then, otherwise: parseTernary() };
  }

  const result = parseTernary();
  if (at !== tokens.length)
    throw new JavaParseError(
      `trailing tokens after the expression in: ${source.trim()}`,
    );
  return result;
};

/** `this.x` and `self.x` say nothing we care about; drop the receiver */
export const withoutThis = (path: string[]): string[] =>
  path[0] === 'this' && path.length > 1 ? path.slice(1) : path;
