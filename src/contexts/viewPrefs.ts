import { useLocalStorage } from '@mantine/hooks';

// Per-browser view preferences: how the page is arranged, not what is in it.
// They live in localStorage rather than in the Yjs document on purpose — a
// collaborator folding their own line list away should not fold away yours.

// Whether the line list is folded down to its head. Two places read it: the
// panel, which draws the chevron, and the navbar grid, which has to hand the
// freed row to the panel below rather than leave it empty.
export const useLinesCollapsed = () =>
  useLocalStorage({ key: 'gtnh:lines-collapsed', defaultValue: false });

// Which library folders are unfolded. Same reasoning as above — where you are
// looking in the tree is yours, not the library's. Folders not in the record
// default to open (see libPanel): a folder only exists because a line was put
// in it, so hiding it by default hides the thing that just moved.
export const useFoldersExpanded = () =>
  useLocalStorage<Record<string, boolean>>({
    key: 'gtnh:folders-expanded',
    defaultValue: {},
  });
