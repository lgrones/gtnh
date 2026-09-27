import type { Expr, ExprEnv, ExprOp, ExprRef } from './types';

// Evaluating and checking the formula trees the machine catalog carries.
//
// The rule throughout: never guess. An unknown reference or operator throws
// rather than defaulting to 0, because a formula that silently evaluates to
// nothing produces a plausible-looking wrong number, and a blank cell in a
// planner is a bug report while a wrong one is a wasted evening.

const OPS = [
  'add',
  'sub',
  'mul',
  'div',
  'pow',
  'min',
  'max',
  'floor',
  'ceil',
  'sqrt',
  'clamp',
  'lookup',
  'when',
  'custom',
] as const;

type OpName = (typeof OPS)[number];

// how many operands each operator takes; `null` means "one or more"
const ARITY: Record<OpName, number | null> = {
  add: null,
  sub: 2,
  mul: null,
  div: 2,
  pow: 2,
  min: null,
  max: null,
  floor: 1,
  ceil: 1,
  sqrt: 1,
  clamp: 3,
  lookup: 2,
  when: 4,
  custom: 1,
};

// takes unknown, not Expr: the catalog is JSON, so a null really can turn up
// here even though the type says otherwise
const isOp = (expr: unknown): expr is ExprOp =>
  typeof expr === 'object' && expr !== null;

const opNameOf = (expr: ExprOp): OpName => {
  const keys = Object.keys(expr);
  const [name] = keys;
  if (keys.length !== 1 || name === undefined)
    throw new TypeError(
      `an operator node must have exactly one key, found ${keys.length}: ${keys.join(', ')}`,
    );
  if (!(OPS as readonly string[]).includes(name))
    throw new TypeError(`unknown operator "${name}"`);
  return name as OpName;
};

const operandsOf = (expr: ExprOp): unknown =>
  (expr as Record<string, unknown>)[opNameOf(expr)];

// ---------------------------------------------------------------------------
// references
// ---------------------------------------------------------------------------

const paramOf = (ref: ExprRef, env: ExprEnv, id: string) => {
  const value = env.params[id];
  if (value === undefined)
    throw new ReferenceError(
      `"${ref}" names a parameter the machine does not declare`,
    );
  return value;
};

/** The value a reference carries as-written — a string for enums and tiers */
export const resolveRaw = (
  ref: ExprRef,
  env: ExprEnv,
): string | number | boolean => {
  const parts = ref.split('.');
  if (parts[0] === 'param' && parts[1] !== undefined && parts.length === 2)
    return paramOf(ref, env, parts[1]).raw;
  return resolveRef(ref, env);
};

export const resolveRef = (ref: ExprRef, env: ExprEnv): number => {
  const parts = ref.split('.');
  const [head, second, third] = parts;

  if (ref === 'tier') return env.tier;
  if (ref === 'amps') return env.amps;

  if (head === 'recipe' && parts.length === 2) {
    if (second === 'heat') return env.recipe.heat;
    if (second === 'eut') return env.recipe.eut;
    if (second === 'duration') return env.recipe.duration;
    throw new ReferenceError(`unknown recipe field in "${ref}"`);
  }

  if (head === 'config' && second !== undefined && parts.length === 2) {
    const value = env.config[second];
    if (value === undefined)
      throw new ReferenceError(
        `"${ref}" names a config value that is not defined`,
      );
    return value;
  }

  if (head === 'param' && second !== undefined) {
    const param = paramOf(ref, env, second);
    if (parts.length === 2) return param.numeric;
    if (parts.length === 3 && third !== undefined) {
      const prop = param.props?.[third];
      if (prop === undefined)
        throw new ReferenceError(
          `parameter "${second}" has no property "${third}"`,
        );
      return prop;
    }
  }

  throw new ReferenceError(`unknown reference "${ref}"`);
};

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------

const asList = (operands: unknown, op: OpName): Expr[] => {
  if (!Array.isArray(operands))
    throw new TypeError(`"${op}" expects a list of operands`);
  return operands as Expr[];
};

// positional operand access that reports the operator rather than yielding
// undefined, since `noUncheckedIndexedAccess` makes every index optional
const at = (operands: unknown, op: OpName, index: number): Expr => {
  const value = asList(operands, op)[index];
  if (value === undefined)
    throw new TypeError(`"${op}" is missing operand ${index}`);
  return value;
};

export const evaluate = (expr: Expr, env: ExprEnv): number => {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') return resolveRef(expr, env);
  if (!isOp(expr)) throw new TypeError(`cannot evaluate ${typeof expr}`);

  const op = opNameOf(expr);
  const operands = operandsOf(expr);
  const go = (e: Expr): number => evaluate(e, env);

  switch (op) {
    case 'add':
      return asList(operands, op).reduce<number>((sum, e) => sum + go(e), 0);
    case 'mul':
      return asList(operands, op).reduce<number>(
        (product, e) => product * go(e),
        1,
      );
    case 'min':
      return Math.min(...asList(operands, op).map(go));
    case 'max':
      return Math.max(...asList(operands, op).map(go));
    case 'sub':
      return go(at(operands, op, 0)) - go(at(operands, op, 1));
    case 'div':
      return go(at(operands, op, 0)) / go(at(operands, op, 1));
    case 'pow':
      return go(at(operands, op, 0)) ** go(at(operands, op, 1));
    case 'clamp':
      return Math.min(
        go(at(operands, op, 2)),
        Math.max(go(at(operands, op, 0)), go(at(operands, op, 1))),
      );
    case 'floor':
      return Math.floor(go(operands as Expr));
    case 'ceil':
      return Math.ceil(go(operands as Expr));
    case 'sqrt':
      return Math.sqrt(go(operands as Expr));
    case 'lookup': {
      const [ref, table, fallback] = asList(operands, op) as [
        ExprRef,
        Record<string, number>,
        number | undefined,
      ];
      const key = String(resolveRaw(ref, env));
      const hit = table[key];
      if (hit !== undefined) return hit;
      if (fallback !== undefined) return fallback;
      throw new ReferenceError(
        `"${key}" is not in the lookup table and there is no fallback`,
      );
    }
    case 'when': {
      const [ref, equals, then, otherwise] = asList(operands, op) as [
        ExprRef,
        string | number | boolean,
        Expr,
        Expr,
      ];
      return resolveRaw(ref, env) === equals ? go(then) : go(otherwise);
    }
    case 'custom': {
      const id = operands as string;
      const fn = env.custom?.[id];
      if (fn === undefined)
        throw new ReferenceError(`no custom formula named "${id}"`);
      return fn(env);
    }
  }
};

// ---------------------------------------------------------------------------
// checking
// ---------------------------------------------------------------------------

const REF_HEADS = new Set(['tier', 'amps', 'recipe', 'param', 'config']);

/**
 * Structural and reference check. Returns the problems found, empty when the
 * expression is sound — the guard test runs this over the whole catalog so a
 * typo'd reference fails the build rather than a render.
 */
export const validateExpr = (
  expr: unknown,
  declaredParams: ReadonlySet<string>,
  configKeys: ReadonlySet<string>,
  customFormulas: ReadonlySet<string> = new Set(),
  path = '$',
): string[] => {
  const problems: string[] = [];
  const recurse = (child: unknown, childPath: string) =>
    problems.push(
      ...validateExpr(
        child,
        declaredParams,
        configKeys,
        customFormulas,
        childPath,
      ),
    );

  if (typeof expr === 'number') {
    if (!Number.isFinite(expr))
      problems.push(`${path}: ${expr} is not a finite number`);
    return problems;
  }

  if (typeof expr === 'string') {
    const parts = expr.split('.');
    const head = parts[0];
    if (head === undefined || !REF_HEADS.has(head))
      problems.push(`${path}: unknown reference "${expr}"`);
    else if (head === 'param') {
      const id = parts[1];
      if (id === undefined)
        problems.push(`${path}: "${expr}" names no parameter`);
      else if (!declaredParams.has(id))
        problems.push(`${path}: "${expr}" names undeclared parameter "${id}"`);
    } else if (head === 'config') {
      const key = parts[1];
      if (key === undefined || !configKeys.has(key))
        problems.push(`${path}: "${expr}" names an undefined config value`);
    } else if (head === 'recipe') {
      if (!['heat', 'eut', 'duration'].includes(parts[1] ?? ''))
        problems.push(`${path}: unknown recipe field in "${expr}"`);
    }
    return problems;
  }

  if (typeof expr !== 'object' || expr === null) {
    problems.push(`${path}: ${typeof expr} is not an expression`);
    return problems;
  }

  let op: OpName;
  try {
    op = opNameOf(expr as ExprOp);
  } catch (error) {
    problems.push(`${path}: ${(error as Error).message}`);
    return problems;
  }

  const operands = (expr as Record<string, unknown>)[op];
  const arity = ARITY[op];

  if (op === 'custom') {
    if (typeof operands !== 'string')
      problems.push(`${path}: custom expects a name`);
    else if (!customFormulas.has(operands))
      problems.push(`${path}: no custom formula named "${operands}"`);
    return problems;
  }

  if (op === 'lookup') {
    const list = Array.isArray(operands) ? operands : [];
    if (list.length < 2 || list.length > 3)
      problems.push(
        `${path}: lookup takes a reference, a table and an optional fallback`,
      );
    else {
      recurse(list[0], `${path}.lookup[0]`);
      const table: unknown = list[1];
      if (
        typeof table !== 'object' ||
        table === null ||
        Object.keys(table).length === 0
      )
        problems.push(`${path}: lookup table is empty`);
    }
    return problems;
  }

  if (op === 'when') {
    const list = Array.isArray(operands) ? operands : [];
    if (list.length !== 4) problems.push(`${path}: when takes four operands`);
    else {
      recurse(list[0], `${path}.when[0]`);
      recurse(list[2], `${path}.when[2]`);
      recurse(list[3], `${path}.when[3]`);
    }
    return problems;
  }

  if (arity === 1) {
    recurse(operands, `${path}.${op}`);
    return problems;
  }

  if (!Array.isArray(operands)) {
    problems.push(`${path}: "${op}" expects a list of operands`);
    return problems;
  }
  if (arity === null ? operands.length === 0 : operands.length !== arity)
    problems.push(
      `${path}: "${op}" expects ${arity ?? 'at least one'} operands, found ${operands.length}`,
    );
  operands.forEach((child, index) => recurse(child, `${path}.${op}[${index}]`));

  return problems;
};
