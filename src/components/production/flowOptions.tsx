import {
  ActionIcon,
  Button,
  Group,
  Menu,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconStarFilled,
  IconStar,
  IconDots,
  IconPencil,
  IconTrash,
  IconCheck,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';

import { useCollab } from '@/contexts/collab/session';
import {
  useActiveLine,
  useProductionLibrary,
} from '@/contexts/productionLibrary';

export const FlowOptions = () => {
  const line = useActiveLine();

  const save = useCollab(state => state.save);
  const { activeId, toggleFavorite, renameGraph, removeGraph } =
    useProductionLibrary(
      useShallow(state => ({
        activeId: state.activeId,
        toggleFavorite: state.toggleFavorite,
        renameGraph: state.renameGraph,
        removeGraph: state.removeGraph,
      })),
    );

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  );

  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    try {
      await save();
      setSaveState('saved');
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('idle');
    }
  }, [save]);

  if (!line) return null;

  const active = line.alternatives.find(alt => alt.id === activeId);
  const onlyOne = line.alternatives.length === 1;

  // save button feedback: spinner while compacting, then a brief "Saved" tick.
  // `loading` disables the button, so overlapping clicks can't stack saves.

  const openRename = () => {
    if (!active) return;

    const id = modals.open({
      title: 'Rename alternative',
      children: (
        <RenameForm
          initial={active.name}
          onSubmit={name => {
            void renameGraph(active.id, name);
            modals.close(id);
          }}
        />
      ),
    });
  };

  const confirmDelete = () => {
    if (!active) return;

    modals.openConfirmModal({
      title: 'Delete alternative',
      children: `Delete "${active.name}"? This can't be undone`,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void removeGraph(active.id),
    });
  };

  return (
    <Group gap="xs">
      <Tooltip label="Save">
        <ActionIcon
          variant="default"
          loading={saveState === 'saving'}
          onClick={() => void handleSave()}
        >
          {saveState === 'saved' ? (
            <IconCheck size={16} />
          ) : (
            <IconDeviceFloppy size={16} />
          )}
        </ActionIcon>
      </Tooltip>

      <Tooltip label="Favorite alternative">
        <ActionIcon
          variant="default"
          c={active?.favorite ? 'yellow' : undefined}
          onClick={() => active && void toggleFavorite(active.id)}
        >
          {active?.favorite ? (
            <IconStarFilled size={16} />
          ) : (
            <IconStar size={16} />
          )}
        </ActionIcon>
      </Tooltip>

      <Menu position="bottom-start" withinPortal>
        <Menu.Target>
          <ActionIcon variant="default">
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconPencil size={14} />}
            onClick={openRename}
          >
            Rename
          </Menu.Item>

          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            disabled={onlyOne}
            onClick={confirmDelete}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
};

// small controlled rename form shown inside a modal
const RenameForm = ({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (name: string) => void;
}) => {
  const [value, setValue] = useState(initial);

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        const name = value.trim();
        if (name) onSubmit(name);
      }}
    >
      <Group gap="xs">
        <TextInput
          data-autofocus
          flex={1}
          value={value}
          onChange={e => setValue(e.currentTarget.value)}
          onFocus={e => e.currentTarget.select()}
        />
        <Button variant="default" type="submit">
          Rename
        </Button>
      </Group>
    </form>
  );
};
