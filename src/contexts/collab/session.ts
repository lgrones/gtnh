import * as Y from 'yjs';
import { create } from 'zustand';

import { useAuth } from '@/contexts/auth';
import {
  graphSnapshot,
  useProductionLibrary,
} from '@/contexts/productionLibrary';
import { useProductionStore } from '@/contexts/productionStore';

import { bindStore, type Binding } from './binding';
import { createGraphDoc, encodeDoc, LOCAL_ORIGIN, type YjsGraph } from './doc';
import { saveSnapshot } from './persistence';
import { colorForUid } from './presence';
import { createRtdbProvider, type RtdbProvider } from './rtdbProvider';

interface CollabState {
  graphId: string | null;
  status: 'idle' | 'loading' | 'ready';
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  // base64 snapshot of the live doc, or null when no session is open. used to
  // seed a new alternative from the current graph's freshest state.
  getSnapshot: () => string | null;
  setCursor: (cursor: { x: number; y: number } | null) => void;
  setSelection: (ids: string[]) => void;
}

const noop = () => {
  /* no-op until a session opens */
};
const asyncNoop = async () => {
  /* no-op until a session opens */
};

export const useCollab = create<CollabState>()(() => ({
  graphId: null,
  status: 'idle',
  canUndo: false,
  canRedo: false,
  undo: noop,
  redo: noop,
  save: asyncNoop,
  getSnapshot: () => null,
  setCursor: noop,
  setSelection: noop,
}));

interface Session {
  graphId: string;
  graph: YjsGraph;
  binding: Binding;
  undoManager: Y.UndoManager;
  provider: RtdbProvider;
  disposeAutosave: () => void;
  save: () => Promise<void>;
}

let current: Session | null = null;

// persist the outgoing graph before it's torn down, so switching alternatives,
// switching lines, or leaving the page never silently drops edits made since the
// last autosave. encodeDoc runs synchronously inside saveSnapshot, so the bytes
// are captured before teardown destroys the doc; the network write + compact
// finish async (best-effort on page unload — the solo stale-tail drop on next
// load is the backstop). no confirm dialog.
const flushCurrent = () => {
  if (current && useAuth.getState().user) void current.save();
};

// trailing debounce — collapse a burst of edits into one snapshot write
const trailingDebounce = (fn: () => void, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };

  return Object.assign(run, { cancel: () => clearTimeout(timer) });
};

const AUTOSAVE_MS = 15_000;

const teardown = () => {
  if (!current) return;
  current.disposeAutosave();
  current.binding.destroy();
  current.provider.destroy();
  current.undoManager.destroy();
  current.graph.doc.destroy();
  current = null;
};

const open = (graphId: string) => {
  flushCurrent();
  teardown();

  const user = useAuth.getState().user;
  if (!user) return;

  // start from a clean slate; the provider hydrates from the snapshot + live tail
  useProductionStore.getState().reset();
  useCollab.setState({ graphId, status: 'loading' });

  const graph = createGraphDoc();

  // undo only the local user's edits — remote/provider origins are untracked
  const undoManager = new Y.UndoManager([graph.nodes, graph.edges], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  const refreshUndo = () =>
    useCollab.setState({
      canUndo: undoManager.canUndo(),
      canRedo: undoManager.canRedo(),
    });

  undoManager.on('stack-item-added', refreshUndo);
  undoManager.on('stack-item-popped', refreshUndo);
  undoManager.on('stack-cleared', refreshUndo);

  const binding = bindStore(graph);

  const self = {
    uid: user.uid,
    name: user.displayName ?? user.email ?? 'Anonymous',
    color: colorForUid(user.uid),
  };

  const snapshot = graphSnapshot(graphId);
  const provider = createRtdbProvider(
    graphId,
    graph,
    self,
    // every signed-in user can edit every graph
    true,
    snapshot,
    () => useCollab.setState({ status: 'ready' }),
  );

  const save = async () => {
    await saveSnapshot(graphId, graph);
    await provider.compact();
  };

  // debounced autosave on local edits only
  const autosave = trailingDebounce(() => void save(), AUTOSAVE_MS);
  const onLocalUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) autosave();
  };
  graph.doc.on('update', onLocalUpdate);

  useCollab.setState({
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    canUndo: false,
    canRedo: false,
    save,
    getSnapshot: () => encodeDoc(graph.doc),
    setCursor: cursor => provider.setPresence({ cursor }),
    setSelection: selection => provider.setPresence({ selection }),
  });

  current = {
    graphId,
    graph,
    binding,
    undoManager,
    provider,
    save,
    disposeAutosave: () => {
      autosave.cancel();
      graph.doc.off('update', onLocalUpdate);
    },
  };
};

const close = () => {
  flushCurrent();
  teardown();
  useProductionStore.getState().reset();
  useCollab.setState({
    graphId: null,
    status: 'idle',
    canUndo: false,
    canRedo: false,
    undo: noop,
    redo: noop,
    save: asyncNoop,
    getSnapshot: () => null,
    setCursor: noop,
    setSelection: noop,
  });
};

// drive the active session off the library's active graph
let lastGraphId: string | null = null;
const react = () => {
  const { activeId } = useProductionLibrary.getState();
  if (activeId === lastGraphId) return;
  lastGraphId = activeId;

  if (!activeId) {
    close();
    return;
  }

  open(activeId);
};

useProductionLibrary.subscribe(react);
// re-evaluate on sign-out (active graph clears)
useAuth.subscribe(() => {
  if (!useAuth.getState().user) {
    lastGraphId = null;
    close();
  }
});

// best-effort persist when the tab is hidden/closed (no confirm dialog). pagehide
// fires on close, navigation, and bfcache; visibilitychange→hidden covers mobile
// tab-switch where pagehide may not fire.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushCurrent);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCurrent();
  });
}

react();
