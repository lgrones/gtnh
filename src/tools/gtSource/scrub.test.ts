import { describe, expect, it } from 'vitest';

import { lineOf, matchBracket, scrub, splitArgs } from './scrub';

// Scrubbing exists so that every later pass can count brackets safely. These
// cases are the ones that actually occur in GT source, not invented ones: a
// `'}'` in a structure string, a comma inside a string literal, a commented-out
// brace left behind by someone's edit.

describe('scrubbing', () => {
  it('keeps the text exactly as long as it was', () => {
    const source = 'int a = 1; // a comment\nString b = "hello";\n';
    expect(scrub(source).text.length).toBe(source.length);
  });

  it('keeps line breaks so line numbers still work', () => {
    const source = 'a\n/* one\ntwo\nthree */\nb';
    const { text } = scrub(source);
    expect(text.split('\n').length).toBe(source.split('\n').length);
    expect(lineOf(text, text.length - 1)).toBe(5);
  });

  it('blanks a brace hiding inside a comment', () => {
    const { text } = scrub('void f() { /* } */ }');
    // the only closing brace left is the real one, at the end
    expect(text.indexOf('}')).toBe(text.length - 1);
  });

  it("blanks the '}' char literal GT's structure code is full of", () => {
    const source = "if (c == '}') { return; }";
    const { text } = scrub(source);
    const open = text.indexOf('{');
    expect(matchBracket(text, open)).toBe(source.length);
  });

  it('remembers what a literal said, keyed by its opening quote', () => {
    const source =
      'new MTEx(ID, "multimachine.blastfurnace", "Electric Blast Furnace")';
    const { literals } = scrub(source);
    expect([...literals.values()]).toEqual([
      'multimachine.blastfurnace',
      'Electric Blast Furnace',
    ]);
  });

  it('survives an escaped quote inside a string', () => {
    const { literals } = scrub(String.raw`String s = "a \" b"; int x;`);
    expect([...literals.values()]).toEqual([String.raw`a \" b`]);
  });
});

describe('matching brackets', () => {
  it('finds the index past the matching close', () => {
    expect(matchBracket('f(a(b), c)', 1)).toBe(10);
  });

  it('answers -1 when nothing closes it', () => {
    expect(matchBracket('f(a(b)', 1)).toBe(-1);
  });
});

describe('splitting an argument list', () => {
  it('ignores commas nested in a call', () => {
    expect(splitArgs('ID, Math.max(1, 2), "x"')).toEqual([
      'ID',
      'Math.max(1, 2)',
      '"x"',
    ]);
  });

  it('ignores commas inside generics', () => {
    expect(splitArgs('Map<String, Integer> a, int b')).toEqual([
      'Map<String, Integer> a',
      'int b',
    ]);
  });

  it('still splits around a less-than comparison', () => {
    expect(splitArgs('a < b, c')).toEqual(['a < b', 'c']);
  });

  it('reads an empty list as no arguments', () => {
    expect(splitArgs('  ')).toEqual([]);
  });
});
