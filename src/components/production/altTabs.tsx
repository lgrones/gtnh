import {
  ActionIcon,
  Button,
  Group,
  SegmentedControl,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowsDiff, IconPlus, IconStarFilled } from '@tabler/icons-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useCollab } from '@/contexts/collab/session';
import {
  useActiveLine,
  useProductionLibrary,
} from '@/contexts/productionLibrary';

import { CompareModalContent } from './compareModal';

const openCompareModal = () =>
  modals.open({
    title: 'Compare alternatives',
    size: 'auto',
    children: <CompareModalContent />,
  });

export const AltTabs = () => {
  const line = useActiveLine();
  const getSnapshot = useCollab(state => state.getSnapshot);
  const { activeId, selectGraph, addAlternative } = useProductionLibrary(
    useShallow(state => ({
      activeId: state.activeId,
      selectGraph: state.selectGraph,
      addAlternative: state.addAlternative,
    })),
  );

  if (!line) return null;

  const onlyOne = line.alternatives.length === 1;

  // branch the current alternative: persist its freshest state, then copy it
  const onCreate = () => {
    if (!activeId) return;

    const id = modals.open({
      title: 'Create alternative',
      children: (
        <CreateForm
          initial=""
          onSubmit={async name => {
            await addAlternative(activeId, name, getSnapshot());
            modals.close(id);
          }}
        />
      ),
    });
  };

  return (
    <Group gap="xs" align="center">
      <Button
        size="xs"
        variant="default"
        leftSection={<IconArrowsDiff size={14} />}
        onClick={openCompareModal}
        disabled={onlyOne}
      >
        Compare
      </Button>

      <Tooltip label="Add alternative">
        <ActionIcon variant="default" size={30} onClick={onCreate}>
          <IconPlus size={16} />
        </ActionIcon>
      </Tooltip>

      <SegmentedControl
        size="xs"
        bg="var(--mantine-color-default)"
        color="var(--mantine-color-dark-9)"
        bd="1px solid var(--mantine-color-default-border)"
        value={activeId ?? undefined}
        onChange={selectGraph}
        data={line.alternatives.map(alt => ({
          value: alt.id,
          label: (
            <Group gap={4}>
              {alt.favorite && (
                <IconStarFilled
                  size={11}
                  color="var(--mantine-color-yellow-text)"
                />
              )}
              <span>{alt.name}</span>
            </Group>
          ),
        }))}
      />
    </Group>
  );
};

const CreateForm = ({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (name: string) => Promise<void> | void;
}) => {
  const [value, setValue] = useState(initial);

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        const name = value.trim();
        if (name) void onSubmit(name);
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
        <Button variant="default" type="submit" disabled={!value.trim()}>
          Create
        </Button>
      </Group>
    </form>
  );
};
