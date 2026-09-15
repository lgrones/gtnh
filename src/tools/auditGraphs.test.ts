// Throwaway audit harness (not a real test): decodes every persisted graph
// snapshot in a Firestore dump and reports the issues validateGraph finds, so
// pre-feature lines can be checked without clicking through the UI.
// Run: AUDIT_DUMP=/path/to/graphs.json pnpm vitest run src/tools/auditGraphs.test.ts
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { test } from 'vitest';

import { decodeGraph } from '@/contexts/collab/decode';
import { lineEnergy, validateGraph } from '@/contexts/productionStore';
import { TICKS_PER_SECOND } from '@/domain/tiers';

interface GraphDoc {
  id: string;
  name: string;
  groupName?: string;
  createdAt?: string;
  snapshot?: string | null;
}

// skipped in a normal `pnpm test` run — it only does anything when pointed at a
// dump
test.skipIf(!process.env.AUDIT_DUMP)('audit', () => {
  const path = process.env.AUDIT_DUMP!;

  const docs = JSON.parse(readFileSync(path, 'utf8')) as GraphDoc[];
  // sidecar: each graph's output-leaf item names, the same projection
  // productionLibrary's `outputNames` uses to seed a line's lockedOutputs
  const sidecar: Record<string, string[]> = {};
  const out = process.env.AUDIT_OUT ?? 'audit.txt';
  writeFileSync(out, '');
  const log = (line: string) => appendFileSync(out, `${line}\n`);

  for (const doc of docs) {
    const { nodes, edges } = decodeGraph(doc.snapshot ?? null);
    const recipes = nodes.filter(n => n.type === 'recipeNode');

    const outputs: string[] = [];
    for (const node of nodes)
      if (node.type === 'outputNode') {
        const name = node.data.name.trim();
        if (name && !outputs.includes(name)) outputs.push(name);
      }
    sidecar[doc.id] = outputs;

    log(
      `\n=== ${doc.groupName ?? '?'} / ${doc.name} (${doc.id}) — ${nodes.length} nodes, ${edges.length} edges, created ${doc.createdAt ?? '?'}`,
    );

    // what the backfill produced for each recipe, so a pre-feature doc that
    // decodes into a bad shape is visible even when validateGraph stays quiet
    for (const node of recipes) {
      const data = node.data;
      const shape =
        data.kind === 'multi'
          ? `multi machine="${data.machine}" hatches=${JSON.stringify(data.hatches)} parallels=${String(data.parallels)} overclock=${String(data.overclock)}`
          : `single voltage=${data.voltage}`;
      log(
        `  · ${data.name || '(unnamed)'} ${shape} eu=${data.eu} t=${data.time} amp=${data.amperage} x${data.multiplier}`,
      );
    }

    // what the stats panel showed BEFORE overclocking was modelled (raw
    // EU/t, no steps) against what it shows now, so the drift on a
    // pre-feature line is visible
    const before = recipes.reduce(
      (total, node) =>
        total +
        (node.data.time > 0
          ? node.data.eu / (node.data.time * TICKS_PER_SECOND)
          : 0),
      0,
    );
    const after = lineEnergy(nodes, edges);
    log(
      `  demand: ${before.toFixed(1)} EU/t before → ${after.demand.toFixed(1)} EU/t now` +
        (before > 0 ? ` (x${(after.demand / before).toFixed(2)})` : ''),
    );

    let issues;
    try {
      issues = validateGraph(nodes, edges);
    } catch (error) {
      log(`  !! validateGraph THREW: ${String(error)}`);
      continue;
    }

    if (issues.length === 0) log('  no issues');
    for (const issue of issues)
      log(
        `  [${issue.kind}] ${issue.recipe} · ${issue.item}` +
          (issue.supply === undefined && issue.demand === undefined
            ? ''
            : ` (supply=${String(issue.supply)} demand=${String(issue.demand)})`),
      );
  }

  if (process.env.AUDIT_OUTPUTS)
    writeFileSync(process.env.AUDIT_OUTPUTS, JSON.stringify(sidecar, null, 2));
});
