import type { Line } from '@/contexts/productionLibrary';

// Folders are not documents. A line carries its whole path from the root in one
// string ("Base Items/Metals") and the tree is rebuilt from those strings, so a
// folder exists exactly as long as a line sits in it: nothing to garbage-collect
// when the last line leaves, and no second collection to keep in sync with the
// first. The price is that an empty folder cannot be kept around — folders are
// made by moving a line into one.
export const FOLDER_SEPARATOR = '/';

// segments of a path, trimmed and with empties dropped, so "/ Base Items //
// Metals " and "Base Items/Metals" are the same folder
export const folderSegments = (path: string): string[] =>
  path
    .split(FOLDER_SEPARATOR)
    .map(segment => segment.trim())
    .filter(segment => segment !== '');

// the canonical form of a path; '' is the root
export const normalizeFolder = (path: string): string =>
  folderSegments(path).join(FOLDER_SEPARATOR);

export const joinFolder = (parent: string, name: string): string =>
  normalizeFolder(`${parent}${FOLDER_SEPARATOR}${name}`);

// the last segment — what the folder is called, as opposed to where it is
export const folderName = (path: string): string =>
  folderSegments(path).at(-1) ?? '';

export const parentFolder = (path: string): string =>
  folderSegments(path).slice(0, -1).join(FOLDER_SEPARATOR);

// `path` is `ancestor` itself or sits somewhere beneath it. The separator is
// load-bearing: a plain prefix test would call "Base Items 2" a child of
// "Base Items".
export const isInFolder = (path: string, ancestor: string): boolean =>
  ancestor === '' ||
  path === ancestor ||
  path.startsWith(ancestor + FOLDER_SEPARATOR);

export interface FolderNode {
  kind: 'folder';
  // full path from the root — also the node's identity, since there is no id
  path: string;
  // last segment only, which is what the row shows
  name: string;
  children: LineTreeNode[];
  // lines anywhere beneath, not just directly in it
  lineCount: number;
}

export interface LineLeaf {
  kind: 'line';
  line: Line;
}

export type LineTreeNode = FolderNode | LineLeaf;

// folders before lines, folders alphabetical. Lines keep the order they came in
// (creation order, as the library hands them over) — the list has always read
// oldest-first and sorting it by name here would silently reorder every
// existing library.
const sortNodes = (nodes: LineTreeNode[]): LineTreeNode[] => {
  const folders = nodes.filter(
    (node): node is FolderNode => node.kind === 'folder',
  );
  const lines = nodes.filter((node): node is LineLeaf => node.kind === 'line');

  folders.sort((a, b) => a.name.localeCompare(b.name));
  for (const folder of folders) folder.children = sortNodes(folder.children);

  return [...folders, ...lines];
};

// the library's flat line list as a tree, with the folder chain of every path
// materialized on the way (a line in "a/b/c" creates a, a/b and a/b/c even
// though only the innermost holds anything)
export const buildLineTree = (lines: Line[]): LineTreeNode[] => {
  const root: LineTreeNode[] = [];
  const folders = new Map<string, FolderNode>();

  const childrenOf = (path: string): LineTreeNode[] => {
    if (path === '') return root;

    const existing = folders.get(path);
    if (existing !== undefined) return existing.children;

    const node: FolderNode = {
      kind: 'folder',
      path,
      name: folderName(path),
      children: [],
      lineCount: 0,
    };

    folders.set(path, node);
    childrenOf(parentFolder(path)).push(node);

    return node.children;
  };

  for (const line of lines) {
    const path = normalizeFolder(line.folder);
    childrenOf(path).push({ kind: 'line', line });

    // the count is "lines beneath me", so it walks the whole chain up
    for (let at = path; at !== ''; at = parentFolder(at)) {
      const folder = folders.get(at);
      if (folder !== undefined) folder.lineCount += 1;
    }
  }

  return sortNodes(root);
};

// every folder that exists, ancestors included, sorted by path — the choices a
// "Move to…" menu offers
export const folderPaths = (lines: Line[]): string[] => {
  const paths = new Set<string>();

  for (const line of lines)
    for (
      let at = normalizeFolder(line.folder);
      at !== '';
      at = parentFolder(at)
    )
      paths.add(at);

  return [...paths].sort((a, b) => a.localeCompare(b));
};
