import { AppShell } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { ReactFlowProvider } from '@xyflow/react';

import { Header } from '@/components/common/header';
import { SplitColumn } from '@/components/common/splitColumn';
import { EnergyPanel } from '@/components/production/energyPanel';
import { Flow } from '@/components/production/flow';
import { IssuePanel } from '@/components/production/issuePanel';
import { LibPanel } from '@/components/production/libPanel';
import { StatsPanel } from '@/components/production/statsPanel';
import { useAsideSplit, useNavSplit } from '@/contexts/viewPrefs';

import classes from './index.module.css';

const Index = () => {
  // where each column's handle was left, kept per browser
  const [navSplit, setNavSplit] = useNavSplit();
  const [asideSplit, setAsideSplit] = useAsideSplit();

  return (
    // the provider wraps the whole page, not just the canvas, so a side panel
    // can frame and select nodes as well
    <ReactFlowProvider>
      <AppShell
        padding="md"
        header={{ height: 80 }}
        navbar={{ width: 340, breakpoint: 0 }}
        aside={{ width: 340, breakpoint: 0 }}
        withBorder={false}
      >
        <AppShell.Header px="md" pt="md">
          <Header />
        </AppShell.Header>

        <AppShell.Navbar>
          <SplitColumn
            className={classes.nav}
            topSize={navSplit}
            onTopSizeChange={setNavSplit}
            top={<LibPanel />}
            bottom={<StatsPanel />}
          />
        </AppShell.Navbar>

        <AppShell.Aside>
          <SplitColumn
            className={classes.aside}
            topSize={asideSplit}
            onTopSizeChange={setAsideSplit}
            top={<EnergyPanel />}
            bottom={<IssuePanel />}
          />
        </AppShell.Aside>

        <AppShell.Main h="100dvh">
          <Flow />
        </AppShell.Main>
      </AppShell>
    </ReactFlowProvider>
  );
};

export const Route = createFileRoute('/')({ component: Index });
