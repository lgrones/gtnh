import { AppShell, Box } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

import { Header } from '@/components/common/header';
import { EnergyPanel } from '@/components/production/energyPanel';
import { Flow } from '@/components/production/flow';
import { IssuePanel } from '@/components/production/issuePanel';
import { LibPanel } from '@/components/production/libPanel';
import { StatsPanel } from '@/components/production/statsPanel';

import classes from './index.module.css';

const Index = () => {
  return (
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
        <Box className={classes.nav}>
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
  );
};

export const Route = createFileRoute('/')({ component: Index });
