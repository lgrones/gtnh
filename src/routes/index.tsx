import { AppShell, Box } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { ReactFlowProvider } from '@xyflow/react';

import { Header } from '@/components/common/header';
import { EnergyPanel } from '@/components/production/energyPanel';
import { Flow } from '@/components/production/flow';
import { IssuePanel } from '@/components/production/issuePanel';
import { LibPanel } from '@/components/production/libPanel';
import { StatsPanel } from '@/components/production/statsPanel';
import { useLinesCollapsed } from '@/contexts/viewPrefs';

import classes from './index.module.css';

const Index = () => {
  // the panel owns the chevron, but the grid owns the row it gives back
  const [linesCollapsed] = useLinesCollapsed();

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
          <Box
            className={classes.nav}
            data-lines-collapsed={linesCollapsed || undefined}
          >
            <LibPanel />

            <StatsPanel />
          </Box>
        </AppShell.Navbar>

        <AppShell.Aside>
          <Box className={classes.aside}>
            <EnergyPanel />

            <IssuePanel />
          </Box>
        </AppShell.Aside>

        <AppShell.Main h="100dvh">
          <Flow />
        </AppShell.Main>
      </AppShell>
    </ReactFlowProvider>
  );
};

export const Route = createFileRoute('/')({ component: Index });
