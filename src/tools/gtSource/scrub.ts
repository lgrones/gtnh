// Pass one of three: make Java safe to count brackets in.
//
// Every later pass — finding a method body, splitting an argument list, reading
// a class header — works by counting `{`, `(` and `,`. A comment or a string
// literal can hold any of those, and `"a, b"` or a commented-out bracket would
// silently move every boundary after it. So before anything else the source is
// rewritten with comments and literal *contents* blanked to same-length filler.
//
// Same-length is the point: every index into the scrubbed text is also an index
// into the original, so a match can be reported at its true line and the real
// text of a literal can be recovered from the untouched original.

/** A literal's real contents, keyed by the index of its opening quote */
export type Literals = ReadonlyMap<number, string>;

export interface Scrubbed {
  /** Same length as the input, with comments and literal contents blanked */
  text: string;
  /** What each blanked literal actually said */
  literals: Literals;
  /** The untouched source, for reporting */
  original: string;
}

// a character that cannot occur in Java source, so a blanked literal can never
// be mistaken for a real identifier by a later regex
const BLANK = '\u0001';

const blanked = (source: string) =>
  // newlines survive so that line numbers keep working; everything else goes
  [...source].map(char => (char === '\n' ? '\n' : ' ')).join('');

/**
 * Blank comments and literal contents, preserving length and line breaks.
 *
 * Handles the four things that can swallow a bracket: `//` to end of line, a
 * block comment, a double-quoted string with backslash escapes, and a
 * single-quoted char — GT's structure definitions are full of `'}'`, which is
 * exactly the unbalanced case this exists to neutralise.
 */
export const scrub = (source: string): Scrubbed => {
  const out: string[] = [];
  const literals = new Map<number, string>();

  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      out.push(blanked(source.slice(index, stop)));
      index = stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out.push(blanked(source.slice(index, stop)));
      index = stop;
      continue;
    }

    if (char === '"' || char === "'") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === char) break;
        cursor += 1;
      }
      const body = source.slice(index + 1, Math.min(cursor, source.length));
      literals.set(index, body);
      out.push(char, BLANK.repeat(body.length));
      if (cursor < source.length) out.push(char);
      index = cursor + 1;
      continue;
    }

    if (char !== undefined) out.push(char);
    index += 1;
  }

  return { text: out.join(''), literals, original: source };
};

/** 1-based line number of an index, for reporting where something came from */
export const lineOf = (text: string, index: number): number => {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1)
    if (text[cursor] === '\n') line += 1;
  return line;
};

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * Index just past the bracket that closes the one at `start`, or -1 if the
 * source never closes it. Only safe on scrubbed text.
 */
export const matchBracket = (text: string, start: number): number => {
  const open = text[start];
  if (open === undefined) return -1;
  const close = CLOSERS[open];
  if (close === undefined) return -1;

  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
};

/**
 * Split an argument list on the commas that belong to it, ignoring commas
 * nested inside brackets or generics. `body` is the text between the brackets.
 *
 * Generics are the subtle case: `Map<String, Integer> x` has a comma at depth 0
 * as far as brackets go. `<` only opens a nesting level when what follows could
 * start a type argument, so an ordinary `a < b` still splits.
 */
export const splitArgs = (body: string): string[] => {
  if (body.trim() === '') return [];

  const parts: string[] = [];
  let depth = 0;
  let angle = 0;
  let start = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === '<' && /[\w?]/.test(body[index + 1] ?? '')) angle += 1;
    else if (char === '>' && angle > 0) angle -= 1;
    else if (char === ',' && depth === 0 && angle === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map(part => part.trim());
};
