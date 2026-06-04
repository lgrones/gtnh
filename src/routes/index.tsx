import { AppShell } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

import { ProductionFlow } from '@/components/production/productionFlow';
import { ProductionFlows } from '@/components/production/productionFlows';
import { ProductionStats } from '@/components/production/productionStats';

const Index = () => {
  return (
    <AppShell
      padding="md"
      navbar={{ width: 400, breakpoint: 0 }}
      withBorder={false}
    >
      <AppShell.Navbar>
        <AppShell.Section grow pl="md" py="md">
          <ProductionFlows />
        </AppShell.Section>

        <AppShell.Section grow pl="md" pb="md">
          <ProductionStats />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main h="100dvh">
        <ProductionFlow />
      </AppShell.Main>
    </AppShell>
  );
};

export const Route = createFileRoute('/')({ component: Index });
