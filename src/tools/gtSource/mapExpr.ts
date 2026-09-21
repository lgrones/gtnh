import type { Expr, MachineParam } from '@/domain/machines/types';

import { withoutThis, type JavaExpr } from './javaExpr';
import { STRUCTURE_GETTERS, STRUCTURE_PARAMS } from './structureParams';

// Pass three, part two: what the Java *means*.
//
// `javaExpr.ts` says "this is a call to GTUtility.getTier whose argument is a
// call to getMaxInputVoltage". This says "that is the tier reference". The two
// are separate so that a change to GT's spelling touches one table here rather
// than the grammar, and so each half can be tested on its own.
//
// The rule is the same as everywhere else in this port: never guess. Anything
// not in a table below throws `MapError`, the caller records it as unresolved
// with the Java text attached, and a human decides. A mapper that quietly
// resolved an unknown field to zero would turn one missing parallel formula
// into a plausible wrong number on someone's factory plan.

export class MapError extends Error {}

export interface MapOptions {
  /** `static final` constants in scope, already folded to numbers */
  constants: Record<string, number>;
  /** Keys that actually exist in gtConfig.json */
  configKeys: ReadonlySet<string>;
  /**
   * Instance fields whose single meaningful assignment the extractor resolved,
   * so `mHeatingCapacity` can stand for what checkMachine assigned to it
   */
  fields?: Record<string, JavaExpr>;
}

export interface Mapped {
  expr: Expr;
  /** Parameters the expression declared by mentioning them */
  params: MachineParam[];
}

// Names that hold a HeatingCoilLevel. GT spells the same idea a dozen ways
// across four mods, and the type is not visible to a text-level parser, so the
// spellings are listed. A name not on this list is unresolved, not assumed.
const COIL_NAMES = new Set([
  'getCoilLevel',
  'getCoilMeta',
  'heatLevel',
  'coilLevel',
  'mCoilLevel',
  'aCoilLevel',
  'checkCoil',
  'mHeatingCapacity',
  'coilHeat',
]);

const COIL_PARAM: MachineParam = {
  id: 'coil',
  kind: 'coilTier',
  label: 'Heating coils',
  default: 'cupronickel',
  primary: true,
  required: true,
};

/**
 * `GTUtility.getTier(getMaxInputVoltage())` — the only shape that means `tier`.
 *
 * `known` follows a name the caller put in scope, because GT usually spells it
 * over two statements: `final long tVoltage = getMaxInputVoltage();` and then
 * `getTier(tVoltage)`.
 */
const isMaxInputVoltage = (
  node: JavaExpr,
  known: Record<string, JavaExpr> = {},
  seen: ReadonlySet<string> = new Set(),
): boolean => {
  if (node.kind === 'call')
    return withoutThis(node.path).join('.') === 'getMaxInputVoltage';
  if (node.kind !== 'name') return false;
  const path = withoutThis(node.path);
  const [head] = path;
  if (path.length !== 1 || head === undefined || seen.has(head)) return false;
  const aliased = known[head];
  return (
    aliased !== undefined &&
    isMaxInputVoltage(aliased, known, new Set([...seen, head]))
  );
};

const mentionsCoil = (path: string[]) =>
  path.some(segment => COIL_NAMES.has(segment));

const say = (node: JavaExpr): string => {
  switch (node.kind) {
    case 'number':
      return String(node.value);
    case 'string':
      return `"${node.value}"`;
    case 'boolean':
      return String(node.value);
    case 'name':
      return node.path.join('.');
    case 'call':
      return `${node.path.join('.')}(${node.args.map(say).join(', ')})`;
    case 'unary':
      return `${node.op}${say(node.operand)}`;
    case 'binary':
      return `${say(node.left)} ${node.op} ${say(node.right)}`;
    case 'ternary':
      return `${say(node.cond)} ? ${say(node.then)} : ${say(node.otherwise)}`;
    case 'cast':
      return `(${node.type}) ${say(node.operand)}`;
  }
};

const ARITHMETIC: Record<string, (left: Expr, right: Expr) => Expr> = {
  '+': (left, right) => ({ add: [left, right] }),
  '-': (left, right) => ({ sub: [left, right] }),
  '*': (left, right) => ({ mul: [left, right] }),
  '/': (left, right) => ({ div: [left, right] }),
};

/**
 * Map a parsed Java expression onto the catalog's `Expr`, collecting any
 * machine parameters it turns out to depend on.
 *
 * @throws MapError when the expression names something no table here covers
 */
export const mapJava = (node: JavaExpr, options: MapOptions): Mapped => {
  const params = new Map<string, MachineParam>();
  const declare = (param: MachineParam) => {
    params.set(param.id, param);
    return param;
  };

  // guard against a field whose assignment mentions itself, directly or through
  // another field — `mTier = mTier + 1` would otherwise recurse forever
  const resolving = new Set<string>();

  const walk = (current: JavaExpr): Expr => {
    switch (current.kind) {
      case 'number':
        return current.value;

      case 'string':
      case 'boolean':
        throw new MapError(`a ${current.kind} is not a numeric expression`);

      case 'cast':
        // Java truncates toward zero; every value reaching a cast in these
        // formulas is a count or a heat, so never negative, and floor agrees
        return { floor: walk(current.operand) };

      case 'unary':
        if (current.op === '!')
          throw new MapError(`cannot negate a condition: ${say(current)}`);
        return { mul: [-1, walk(current.operand)] };

      case 'binary': {
        const build = ARITHMETIC[current.op];
        if (build === undefined)
          throw new MapError(
            `"${current.op}" has no counterpart in the catalog's expressions`,
          );
        return build(walk(current.left), walk(current.right));
      }

      case 'ternary':
        return walkTernary(current);

      case 'name':
        return walkName(current);

      case 'call':
        return walkCall(current);
    }
  };

  const walkName = (current: JavaExpr & { kind: 'name' }): Expr => {
    const path = withoutThis(current.path);
    const [head, ...rest] = path;
    if (head === undefined) throw new MapError('an empty name');

    // a pack config value, and only one that gtConfig.json actually carries —
    // otherwise the catalog would reference a key nothing can resolve
    if (head === 'Configuration') {
      const key = path.at(-1);
      if (key !== undefined && options.configKeys.has(key))
        return `config.${key}`;
      throw new MapError(
        `${path.join('.')} is not a config value gtConfig.json carries`,
      );
    }

    if (rest.length === 0) {
      const constant = options.constants[head];
      if (constant !== undefined) return constant;

      const structure = STRUCTURE_PARAMS[head];
      if (structure !== undefined)
        return `param.${declare(structure.param).id}`;

      const assigned = options.fields?.[head];
      if (assigned !== undefined && !resolving.has(head)) {
        resolving.add(head);
        try {
          return walk(assigned);
        } finally {
          resolving.delete(head);
        }
      }

      if (COIL_NAMES.has(head)) return `param.${declare(COIL_PARAM).id}.heat`;
    }

    throw new MapError(`no rule for the name ${path.join('.')}`);
  };

  const walkCall = (current: JavaExpr & { kind: 'call' }): Expr => {
    const path = withoutThis(current.path);
    const name = path.join('.');
    const last = path.at(-1);
    const args = current.args;

    if (name === 'GTUtility.getTier') {
      const [only] = args;
      if (
        args.length === 1 &&
        only !== undefined &&
        isMaxInputVoltage(only, options.fields ?? {})
      )
        return 'tier';
      throw new MapError(
        `getTier of something other than getMaxInputVoltage: ${say(current)}`,
      );
    }

    // HeatingCoilLevel's two accessors. Both are read in the wild — the EBF
    // family wants the heat in K, the Pyrolyse Oven the 0-based tier
    if (last === 'getHeat' && mentionsCoil(path))
      return `param.${declare(COIL_PARAM).id}.heat`;
    if (last === 'getTier' && mentionsCoil(path))
      return `param.${declare(COIL_PARAM).id}.tier`;

    if (last !== undefined && path.length === 1) {
      const field = STRUCTURE_GETTERS[last];
      const structure =
        field === undefined ? undefined : STRUCTURE_PARAMS[field];
      if (structure !== undefined)
        return `param.${declare(structure.param).id}`;
    }

    const mapped = mapKnownCall(name, args.map(walk));
    if (mapped !== undefined) return mapped;

    throw new MapError(`no rule for the call ${say(current)}`);
  };

  // A condition the catalog can express: a reference compared against a
  // constant, or a plain boolean reference. Anything richer — two fields
  // compared, a chain of `&&` — is left unresolved rather than flattened.
  const walkTernary = (current: JavaExpr & { kind: 'ternary' }): Expr => {
    const then = walk(current.then);
    const otherwise = walk(current.otherwise);
    const cond = current.cond;

    if (cond.kind === 'binary' && (cond.op === '==' || cond.op === '!=')) {
      const reference = walk(cond.left);
      if (typeof reference !== 'string')
        throw new MapError(`the left of ${say(cond)} is not a reference`);
      const literal = cond.right;
      if (literal.kind !== 'number' && literal.kind !== 'boolean')
        throw new MapError(`${say(cond)} does not compare against a constant`);
      return cond.op === '=='
        ? { when: [reference, literal.value, then, otherwise] }
        : { when: [reference, literal.value, otherwise, then] };
    }

    if (cond.kind === 'name' || cond.kind === 'call') {
      const reference = walk(cond);
      if (typeof reference === 'string')
        return { when: [reference, true, then, otherwise] };
    }

    throw new MapError(`cannot express the condition ${say(cond)}`);
  };

  return { expr: walk(node), params: [...params.values()] };
};

/** The calls that are just arithmetic under another name */
const mapKnownCall = (name: string, args: Expr[]): Expr | undefined => {
  const [first, second] = args;
  switch (name) {
    case 'Math.max':
      return { max: args };
    case 'Math.min':
      return { min: args };
    case 'Math.floor':
      return first === undefined ? undefined : { floor: first };
    case 'Math.ceil':
      return first === undefined ? undefined : { ceil: first };
    case 'Math.sqrt':
      return first === undefined ? undefined : { sqrt: first };
    case 'Math.pow':
    case 'GTUtility.powInt':
      return first === undefined || second === undefined
        ? undefined
        : { pow: [first, second] };
    default:
      return undefined;
  }
};
