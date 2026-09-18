import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  Group,
  Menu,
  Text,
  TextInput,
  Tooltip,
  Tree,
  useTree,
  type RenderTreeNodePayload,
  type TreeNodeData,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconChevronRight,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Panel } from '@/components/common/panel';
import {
  buildLineTree,
  folderPaths,
  isInFolder,
  joinFolder,
  normalizeFolder,
  parentFolder,
  type LineTreeNode,
} from '@/contexts/lineTree';
import {
  useLines,
  useProductionLibrary,
  type Line,
} from '@/contexts/productionLibrary';
import { useFoldersExpanded, useLinesCollapsed } from '@/contexts/viewPrefs';

// Tree node values have to be unique across the whole tree and stable across a
// rename, so a line is keyed by its groupId rather than its path — moving a
// line between folders must not read as a different node, or it would lose
// focus mid-drag. Folders have no id at all: their path IS their identity.
const FOLDER_PREFIX = 'folder:';
const LINE_PREFIX = 'line:';

const folderValue = (path: string) => `${FOLDER_PREFIX}${path}`;
const lineValue = (groupId: string) => `${LINE_PREFIX}${groupId}`;

const toTreeData = (nodes: LineTreeNode[]): TreeNodeData[] =>
  nodes.map(node =>
    node.kind === 'folder'
      ? {
          value: folderValue(node.path),
          label: node.name,
          children: toTreeData(node.children),
          nodeProps: { node },
        }
      : {
          value: lineValue(node.line.groupId),
          label: node.line.name,
          nodeProps: { node },
        },
  );

// the tree node behind a rendered row. Mantine types `nodeProps` as an open
// record, so this is where that widening is paid back.
const nodeOf = (data: TreeNodeData): LineTreeNode =>
  data.nodeProps?.node as LineTreeNode;

// a folder is named by typing, and every place that happens (new folder, rename
// folder, move to a new folder) wants the same one-field form. Submitting on
// Enter matters more than it looks: this modal is opened from a menu item, so
// the mouse is already somewhere else by the time it appears.
const FolderNameForm = ({
  initial,
  label,
  submitLabel,
  onSubmit,
}: {
  initial: string;
  label: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) => {
  const [value, setValue] = useState(initial);
  const name = normalizeFolder(value);

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (name === '') return;
        onSubmit(name);
        modals.close(FOLDER_MODAL);
      }}
    >
      <TextInput
        data-autofocus
        label={label}
        placeholder="Base Items/Metals"
        description="Slashes make sub-folders"
        value={value}
        onChange={event => setValue(event.currentTarget.value)}
      />

      <Group justify="flex-end" mt="md">
        <Button type="submit" disabled={name === ''}>
          {submitLabel}
        </Button>
      </Group>
    </form>
  );
};

const FOLDER_MODAL = 'folder-name';

const promptFolderName = (
  props: React.ComponentProps<typeof FolderNameForm> & { title: string },
) =>
  modals.open({
    modalId: FOLDER_MODAL,
    title: props.title,
    children: <FolderNameForm {...props} />,
  });

// the "Move to" list, shared by folder and line rows: every folder that exists,
// the root, and the escape hatch of naming one that does not exist yet — which
// is the only way an empty folder could be made, since a folder is only ever
// the path its lines carry.
const MoveMenuItems = ({
  current,
  exclude,
  onMove,
}: {
  current: string;
  // paths the thing being moved cannot land in (itself and its own subtree)
  exclude?: string;
  onMove: (folder: string) => void;
}) => {
  const lines = useLines();
  const paths = folderPaths(lines).filter(
    path => exclude === undefined || !isInFolder(path, exclude),
  );

  return (
    <>
      <Menu.Item
        disabled={current === ''}
        onClick={() => onMove('')}
        leftSection={<IconFolder size={14} />}
      >
        Top level
      </Menu.Item>

      {paths.map(path => (
        <Menu.Item
          key={path}
          disabled={path === current}
          onClick={() => onMove(path)}
          leftSection={<IconFolder size={14} />}
        >
          {path}
        </Menu.Item>
      ))}

      <Menu.Item
        leftSection={<IconFolderPlus size={14} />}
        onClick={() =>
          promptFolderName({
            title: 'New folder',
            label: 'Folder name',
            submitLabel: 'Move here',
            initial: '',
            onSubmit: onMove,
          })
        }
      >
        New folder…
      </Menu.Item>
    </>
  );
};

// A row's indentation is the tree's own `--label-offset`, which the class in
// `elementProps` applies as padding-inline-start — so a row must not set `px`,
// or every level lands on the same column. The negative margin puts the row
// back out to the panel's padding edge (that is what keeps a highlighted row's
// rounded corners off the scrollbar), and the padding puts the content back.
const rowStyle = (
  elementProps: RenderTreeNodePayload['elementProps'],
): React.CSSProperties => ({
  ...elementProps.style,
  marginInline: 'calc(var(--mantine-spacing-xs) * -1)',
  paddingInlineStart:
    'calc(var(--label-offset, 0px) + var(--mantine-spacing-xs))',
  paddingInlineEnd: 4,
  borderRadius: 'var(--mantine-radius-default)',
});

// one library row = one production line (a group of alternatives). the name
// input is uncontrolled (defaultValue) on purpose: rename writes to Firestore
// and the new name only comes back a render later via the snapshot, so a
// *controlled* value lags and resets the caret on every keystroke. letting the
// DOM own the value keeps the caret put; the row is keyed by groupId upstream,
// so it re-seeds defaultValue when the line changes.
const LineRow = ({
  line,
  active,
  elementProps,
  dragHandleProps,
  onSelect,
  onRename,
  onMove,
  onDelete,
}: {
  line: Line;
  active: boolean;
  elementProps: RenderTreeNodePayload['elementProps'];
  dragHandleProps: RenderTreeNodePayload['dragHandleProps'];
  onSelect: (line: Line) => void;
  onRename: (groupId: string, name: string) => void;
  onMove: (groupId: string, folder: string) => void;
  onDelete: (groupId: string) => void;
}) => (
  <Group
    {...elementProps}
    // the tree's own click handler moves focus to the row, which would take it
    // straight back off the rename input the click just landed in
    onClick={() => onSelect(line)}
    gap={4}
    wrap="nowrap"
    bg={active ? 'gray.9' : undefined}
    style={rowStyle(elementProps)}
  >
    <IconGripVertical
      {...dragHandleProps}
      size={14}
      opacity={0.35}
      style={{ cursor: 'grab', flexShrink: 0 }}
    />

    <TextInput
      flex={1}
      variant="unstyled"
      defaultValue={line.name}
      onFocus={() => onSelect(line)}
      onChange={e => onRename(line.groupId, e.currentTarget.value)}
      styles={{ input: { backgroundColor: 'transparent', border: 'none' } }}
    />

    {line.alternatives.length > 1 && (
      <Tooltip label="Alternatives">
        <Badge size="sm" variant="light" color="gray">
          {line.alternatives.length}
        </Badge>
      </Tooltip>
    )}

    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Move line"
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>Move to</Menu.Label>

        <MoveMenuItems
          current={line.folder}
          onMove={folder => onMove(line.groupId, folder)}
        />
      </Menu.Dropdown>
    </Menu>

    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      aria-label="Delete line"
      onClick={() =>
        modals.openConfirmModal({
          title: 'Delete production line',
          children: (
            <Text size="sm">
              You sure you wanna delete this production line
              {line.alternatives.length > 1
                ? ` and all ${line.alternatives.length} alternatives`
                : ''}
              ?
            </Text>
          ),
          labels: { confirm: 'Delete', cancel: 'Cancel' },
          confirmProps: { color: 'red' },
          onConfirm: () => onDelete(line.groupId),
        })
      }
    >
      <IconX size={16} />
    </ActionIcon>
  </Group>
);

// a folder row. It holds no state of its own — the path it shows is the one its
// lines carry, so renaming it is a write to every line beneath it, and deleting
// it only means those lines move up a level.
const FolderRow = ({
  path,
  name,
  count,
  expanded,
  elementProps,
  dragHandleProps,
  onToggle,
  onNewLine,
  onRename,
  onMove,
  onDelete,
}: {
  path: string;
  name: string;
  count: number;
  expanded: boolean;
  elementProps: RenderTreeNodePayload['elementProps'];
  dragHandleProps: RenderTreeNodePayload['dragHandleProps'];
  onToggle: () => void;
  onNewLine: (folder: string) => void;
  onRename: (path: string, next: string) => void;
  onMove: (path: string, parent: string) => void;
  onDelete: (path: string) => void;
}) => (
  <Group
    {...elementProps}
    onClick={onToggle}
    gap={4}
    wrap="nowrap"
    style={rowStyle(elementProps)}
  >
    <IconGripVertical
      {...dragHandleProps}
      size={14}
      opacity={0.35}
      style={{ cursor: 'grab', flexShrink: 0 }}
    />

    <IconChevronRight
      size={14}
      style={{
        flexShrink: 0,
        transform: expanded ? 'rotate(90deg)' : undefined,
        transition: 'transform 150ms ease',
      }}
    />

    <IconFolder size={14} style={{ flexShrink: 0 }} />

    <Text size="sm" fw={500} flex={1} truncate>
      {name}
    </Text>

    <Text size="xs" c="dimmed">
      {count}
    </Text>

    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Folder actions"
          // the row toggles on click; the menu button is not a toggle
          onClick={event => event.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown onClick={event => event.stopPropagation()}>
        <Menu.Item
          leftSection={<IconPlus size={14} />}
          onClick={() => onNewLine(path)}
        >
          New line here
        </Menu.Item>

        <Menu.Item
          leftSection={<IconPencil size={14} />}
          onClick={() =>
            promptFolderName({
              title: 'Rename folder',
              label: 'Folder name',
              submitLabel: 'Rename',
              initial: name,
              onSubmit: next =>
                onRename(path, joinFolder(parentFolder(path), next)),
            })
          }
        >
          Rename…
        </Menu.Item>

        <Menu.Label>Move to</Menu.Label>

        <MoveMenuItems
          current={parentFolder(path)}
          exclude={path}
          onMove={parent => onMove(path, parent)}
        />

        <Menu.Divider />

        <Menu.Item
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() =>
            modals.openConfirmModal({
              title: 'Delete folder',
              children: (
                <Text size="sm">
                  Delete “{name}”? The {count} line{count === 1 ? '' : 's'}{' '}
                  inside move up to{' '}
                  {parentFolder(path) === ''
                    ? 'the top level'
                    : `“${parentFolder(path)}”`}
                  .
                </Text>
              ),
              labels: { confirm: 'Delete folder', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: () => onDelete(path),
            })
          }
        >
          Delete folder
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  </Group>
);

export const LibPanel = () => {
  const lines = useLines();
  const [collapsed, setCollapsed] = useLinesCollapsed();
  const [storedExpanded, setStoredExpanded] = useFoldersExpanded();
  const [query, setQuery] = useState('');
  const {
    activeId,
    createGraph,
    selectGraph,
    renameLine,
    removeLine,
    moveLine,
    renameFolder,
    removeFolder,
  } = useProductionLibrary(
    useShallow(state => ({
      activeId: state.activeId,
      createGraph: state.createGraph,
      selectGraph: state.selectGraph,
      renameLine: state.renameLine,
      removeLine: state.removeLine,
      moveLine: state.moveLine,
      renameFolder: state.renameFolder,
      removeFolder: state.removeFolder,
    })),
  );

  // selecting a line opens its favorite-or-first alternative (alternatives are
  // already sorted favorites-first)
  const selectLine = (line: Line) =>
    selectGraph(line.alternatives[0]?.id ?? '');

  // alternatives are searched as well as the line itself: they carry their own
  // names, and "the one where I tried a second EBF" is how you remember a line.
  // So is "it's in Base Items somewhere", hence the folder path.
  const needle = query.trim().toLowerCase();
  const searching = needle !== '';

  const treeData = useMemo(() => {
    const shown = !searching
      ? lines
      : lines.filter(
          line =>
            line.name.toLowerCase().includes(needle) ||
            line.folder.toLowerCase().includes(needle) ||
            line.alternatives.some(alt =>
              alt.name.toLowerCase().includes(needle),
            ),
        );

    return toTreeData(buildLineTree(shown));
  }, [lines, needle, searching]);

  // a folder nobody has touched starts open: it exists only because a line was
  // put in it, and a folded-away folder hides exactly the line that just moved.
  // While searching every folder is forced open — a hit inside a closed folder
  // is a hit you cannot see.
  const expandedState = useMemo(() => {
    const state: Record<string, boolean> = {};

    const walk = (nodes: TreeNodeData[]) => {
      for (const node of nodes) {
        if (node.children === undefined) continue;
        state[node.value] = searching || (storedExpanded[node.value] ?? true);
        walk(node.children);
      }
    };

    walk(treeData);

    return state;
  }, [treeData, storedExpanded, searching]);

  const tree = useTree({
    expandedState,
    onExpandedStateChange: next => {
      // the search's own unfolding is not the user's choice, so it is not
      // remembered as one
      if (searching) return;

      setStoredExpanded(prev => {
        const merged = { ...prev };
        let changed = false;

        for (const [value, open] of Object.entries(next)) {
          if (!value.startsWith(FOLDER_PREFIX) || merged[value] === open)
            continue;

          merged[value] = open;
          changed = true;
        }

        return changed ? merged : prev;
      });
    },
  });

  // where a drop lands: onto a folder means into it, between two rows means
  // alongside them — i.e. into whatever folder holds them. The tree's own
  // ordering is not persisted (lines are listed oldest-first, folders by name),
  // so before/after differ from each other only in which folder they imply.
  const destinationOf = (target: LineTreeNode, position: string): string =>
    target.kind === 'folder'
      ? position === 'inside'
        ? target.path
        : parentFolder(target.path)
      : target.line.folder;

  const byValue = useMemo(() => {
    const map = new Map<string, LineTreeNode>();

    const walk = (nodes: TreeNodeData[]) => {
      for (const node of nodes) {
        map.set(node.value, nodeOf(node));
        if (node.children !== undefined) walk(node.children);
      }
    };

    walk(treeData);

    return map;
  }, [treeData]);

  return (
    <Panel
      title="Production Lines"
      gap="xs"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!collapsed)}
      action={
        <Group gap={4} wrap="nowrap">
          {collapsed && lines.length > 0 && (
            <Text size="sm" c="dimmed">
              {lines.length}
            </Text>
          )}

          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => void createGraph()}
            aria-label="New line"
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Group>
      }
      // the filter belongs with the head: scrolled out of reach it would be
      // unusable exactly when the list is long enough to need it
      pinned={
        lines.length > 1 && (
          <TextInput
            size="xs"
            placeholder="Search lines"
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
            rightSection={
              query !== '' && (
                <CloseButton
                  size="sm"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                />
              )
            }
          />
        )
      }
    >
      {treeData.length === 0 ? (
        <Text size="sm" c="dimmed">
          {lines.length === 0 ? 'No lines yet' : `Nothing matches "${query}"`}
        </Text>
      ) : (
        <Tree
          data={treeData}
          tree={tree}
          levelOffset="md"
          // both row kinds handle their own click: a folder toggles, a line
          // opens. Mantine's default would additionally pull focus to the row,
          // which fights the inline rename input
          expandOnClick={false}
          withDragHandle
          allowDrop={({ draggedNode, targetNode, position }) => {
            const dragged = byValue.get(draggedNode);
            const target = byValue.get(targetNode);
            if (dragged === undefined || target === undefined) return false;

            // a line goes anywhere; a folder cannot be dropped into its own
            // subtree, which would take the subtree with it
            return (
              dragged.kind === 'line' ||
              !isInFolder(destinationOf(target, position), dragged.path)
            );
          }}
          onDragDrop={({ draggedNode, targetNode, position }) => {
            const dragged = byValue.get(draggedNode);
            const target = byValue.get(targetNode);
            if (dragged === undefined || target === undefined) return;

            const folder = destinationOf(target, position);

            if (dragged.kind === 'line')
              void moveLine(dragged.line.groupId, folder);
            else
              void renameFolder(dragged.path, joinFolder(folder, dragged.name));
          }}
          renderNode={payload => {
            const node = nodeOf(payload.node);

            return node.kind === 'folder' ? (
              <FolderRow
                path={node.path}
                name={node.name}
                count={node.lineCount}
                expanded={payload.expanded}
                elementProps={payload.elementProps}
                dragHandleProps={payload.dragHandleProps}
                onToggle={() => tree.toggleExpanded(payload.node.value)}
                onNewLine={folder => void createGraph(folder)}
                onRename={(path, next) => void renameFolder(path, next)}
                onMove={(path, parent) =>
                  void renameFolder(path, joinFolder(parent, node.name))
                }
                onDelete={path => void removeFolder(path)}
              />
            ) : (
              <LineRow
                line={node.line}
                active={node.line.alternatives.some(alt => alt.id === activeId)}
                elementProps={payload.elementProps}
                dragHandleProps={payload.dragHandleProps}
                onSelect={selectLine}
                onRename={(groupId, name) => void renameLine(groupId, name)}
                onMove={(groupId, folder) => void moveLine(groupId, folder)}
                onDelete={groupId => void removeLine(groupId)}
              />
            );
          }}
        />
      )}
    </Panel>
  );
};
