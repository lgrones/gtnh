import { describe, expect, it } from 'vitest';

import {
  buildLineTree,
  folderName,
  folderPaths,
  folderSegments,
  isInFolder,
  joinFolder,
  normalizeFolder,
  parentFolder,
  type FolderNode,
  type LineTreeNode,
} from '@/contexts/lineTree';
import type { Line } from '@/contexts/productionLibrary';

const line = (name: string, folder = ''): Line => ({
  groupId: name,
  name,
  folder,
  lockedOutputs: [],
  alternatives: [],
});

// what a tree row reads as, so the expectations below say shape rather than
// object graph
const outline = (nodes: LineTreeNode[], depth = 0): string[] =>
  nodes.flatMap(node =>
    node.kind === 'line'
      ? [`${'  '.repeat(depth)}- ${node.line.name}`]
      : [
          `${'  '.repeat(depth)}+ ${node.name} (${node.lineCount})`,
          ...outline(node.children, depth + 1),
        ],
  );

describe('folder paths', () => {
  it('drops empty and untrimmed segments', () => {
    expect(folderSegments(' / Base Items // Metals ')).toEqual([
      'Base Items',
      'Metals',
    ]);
    expect(normalizeFolder('/Base Items//Metals/')).toBe('Base Items/Metals');
    expect(normalizeFolder('   ')).toBe('');
  });

  it('splits a path into where it is and what it is called', () => {
    expect(folderName('Base Items/Metals')).toBe('Metals');
    expect(parentFolder('Base Items/Metals')).toBe('Base Items');
    expect(folderName('Metals')).toBe('Metals');
    expect(parentFolder('Metals')).toBe('');
    expect(folderName('')).toBe('');
  });

  it('joins onto the root without a leading separator', () => {
    expect(joinFolder('', 'Metals')).toBe('Metals');
    expect(joinFolder('Base Items', 'Metals')).toBe('Base Items/Metals');
  });

  it('does not mistake a name prefix for a parent', () => {
    expect(isInFolder('Base Items/Metals', 'Base Items')).toBe(true);
    expect(isInFolder('Base Items', 'Base Items')).toBe(true);
    expect(isInFolder('Base Items 2', 'Base Items')).toBe(false);
    // everything is in the root
    expect(isInFolder('Base Items', '')).toBe(true);
  });
});

describe('buildLineTree', () => {
  it('keeps unfoldered lines at the root in the order given', () => {
    expect(outline(buildLineTree([line('Steel'), line('Aluminium')]))).toEqual([
      '- Steel',
      '- Aluminium',
    ]);
  });

  it('materializes the whole folder chain of a path', () => {
    expect(
      outline(buildLineTree([line('Tungstensteel', 'Base Items/Metals')])),
    ).toEqual(['+ Base Items (1)', '  + Metals (1)', '    - Tungstensteel']);
  });

  it('counts lines anywhere beneath a folder', () => {
    const tree = buildLineTree([
      line('Steel', 'Base Items'),
      line('Tungstensteel', 'Base Items/Metals'),
      line('Titanium', 'Base Items/Metals'),
      line('Rocket Fuel'),
    ]);

    expect(outline(tree)).toEqual([
      '+ Base Items (3)',
      '  + Metals (2)',
      '    - Tungstensteel',
      '    - Titanium',
      '  - Steel',
      '- Rocket Fuel',
    ]);
  });

  it('sorts folders alphabetically before lines, lines as given', () => {
    const tree = buildLineTree([
      line('Rocket Fuel'),
      line('Steel', 'Metals'),
      line('Plastic', 'Chemistry'),
      line('Naquadah'),
    ]);

    expect(outline(tree)).toEqual([
      '+ Chemistry (1)',
      '  - Plastic',
      '+ Metals (1)',
      '  - Steel',
      '- Rocket Fuel',
      '- Naquadah',
    ]);
  });

  it('treats sloppy and canonical paths as the same folder', () => {
    const tree = buildLineTree([
      line('Steel', 'Base Items/Metals'),
      line('Titanium', ' Base Items / Metals '),
    ]);

    expect(tree).toHaveLength(1);
    expect((tree[0] as FolderNode).lineCount).toBe(2);
  });

  it('is empty for an empty library', () => {
    expect(buildLineTree([])).toEqual([]);
  });
});

describe('folderPaths', () => {
  it('lists every folder including ancestors, sorted', () => {
    expect(
      folderPaths([
        line('Tungstensteel', 'Base Items/Metals'),
        line('Plastic', 'Chemistry'),
        line('Rocket Fuel'),
      ]),
    ).toEqual(['Base Items', 'Base Items/Metals', 'Chemistry']);
  });
});
