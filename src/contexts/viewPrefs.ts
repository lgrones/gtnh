import { useLocalStorage } from '@mantine/hooks';

// Per-browser view preferences: how the page is arranged, not what is in it.
// They live in localStorage rather than in the Yjs document on purpose — a
// collaborator folding their own line list away should not fold away yours.

// Which library folders are unfolded. Same reasoning as above — where you are
// looking in the tree is yours, not the library's. Folders not in the record
// default to open (see libPanel): a folder only exists because a line was put
// in it, so hiding it by default hides the thing that just moved.
export const useFoldersExpanded = () =>
  useLocalStorage<Record<string, boolean>>({
    key: 'gtnh:folders-expanded',
    defaultValue: {},
  });

// How each side column is divided between its two panels: the percentage of the
// column's height the top one gets. Dragged by the splitter between them (see
// common/splitColumn), and per-browser for the same reason as the fold above —
// how tall you like your issue list is not part of the line.
export const useNavSplit = () =>
  useLocalStorage({ key: 'gtnh:nav-split', defaultValue: 50 });

export const useAsideSplit = () =>
  useLocalStorage({ key: 'gtnh:aside-split', defaultValue: 50 });
