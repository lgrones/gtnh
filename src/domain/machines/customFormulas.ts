import type { ExprEnv } from './types';

// The escape hatch for machines whose parallel rule is genuinely branchier than
// an expression tree should carry — the PCB Factory computing a cap from its
// structure and cooling tiers during checkMachine, the Electric Implosion
// Compressor's block-tier power, the Industrial Arc Furnace switching on plasma
// mode.
//
// Deliberately capped, and the cap is a ratchet the guard test enforces. Every
// entry here is a machine whose behaviour stopped being data, so raising the
// limit should take a commit and an argument.
export const CUSTOM_FORMULA_LIMIT = 12;

export const CUSTOM_FORMULAS: Record<string, (env: ExprEnv) => number> = {};
