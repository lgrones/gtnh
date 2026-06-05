import * as Y from 'yjs';
import { create } from 'zustand';

import { useAuth } from '@/contexts/auth';
import {
  useProductionLibrary,
  type GraphRole,
} from '@/contexts/productionLibrary';
import { useProductionStore } from '@/contexts/productionStore';

import { bindStore, type Binding } from './binding';
import { createGraphDoc, LOCAL_ORIGIN, type YjsGraph } from './doc';
import { saveSnapshot } from './persistence';
import { colorForUid } from './presence';
import { createRtdbProvider, type RtdbProvider } from './rtdbProvider';

interface CollabState {
  graphId: string | null;
  status: 'idle' | 'loading' | 'ready';
  role: GraphRole | undefined;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
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
  role: undefined,
  canUndo: false,
  canRedo: false,
  undo: noop,
  redo: noop,
  save: asyncNoop,
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
}

let current: Session | null = null;

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

const open = (graphId: string, role: GraphRole) => {
  teardown();

  const user = useAuth.getState().user;
  if (!user) return;

  // start from a clean slate; the provider hydrates from the snapshot + live tail
  useProductionStore.getState().reset();
  useCollab.setState({ graphId, role, status: 'loading' });

  const canWrite = role !== 'viewer';
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
  const provider = createRtdbProvider(graphId, graph, self, canWrite, () =>
    useCollab.setState({ status: 'ready' }),
  );

  const save = async () => {
    await saveSnapshot(graphId, graph);
    await provider.compact();
  };

  // debounced autosave on local edits only (editors only)
  const autosave = trailingDebounce(() => void save(), AUTOSAVE_MS);
  const onLocalUpdate = (_u: Uint8Array, origin: unknown) => {
    if (canWrite && origin === LOCAL_ORIGIN) autosave();
  };
  graph.doc.on('update', onLocalUpdate);

  useCollab.setState({
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    canUndo: false,
    canRedo: false,
    save,
    setCursor: cursor => provider.setPresence({ cursor }),
    setSelection: selection => provider.setPresence({ selection }),
  });

  current = {
    graphId,
    graph,
    binding,
    undoManager,
    provider,
    disposeAutosave: () => {
      autosave.cancel();
      graph.doc.off('update', onLocalUpdate);
    },
  };
};

const close = () => {
  teardown();
  useProductionStore.getState().reset();
  useCollab.setState({
    graphId: null,
    status: 'idle',
    role: undefined,
    canUndo: false,
    canRedo: false,
    undo: noop,
    redo: noop,
    save: asyncNoop,
    setCursor: noop,
    setSelection: noop,
  });
};

// drive the active session off the library's active graph
let lastGraphId: string | null = null;
const react = () => {
  const { activeId, graphs } = useProductionLibrary.getState();
  if (activeId === lastGraphId) return;
  lastGraphId = activeId;

  if (!activeId) {
    close();
    return;
  }
  const role = graphs.find(graph => graph.id === activeId)?.role ?? 'viewer';
  open(activeId, role);
};

useProductionLibrary.subscribe(react);
// re-evaluate on sign-out (active graph clears)
useAuth.subscribe(() => {
  if (!useAuth.getState().user) {
    lastGraphId = null;
    close();
  }
});
react();
