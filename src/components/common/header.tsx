import { Group, Image, Paper, Title } from '@mantine/core';

import { AccountMenu } from '../auth/accountMenu';
import { LinkButton } from './linkButton';

export const Header = () => {
  return (
    <Paper component={Group} justify="space-between" h="100%" p="md">
      <Group gap="xl">
        <Group>
          <Image h={38} w="auto" src="/assets/gtnhLogo.png" />
          <Title fz="h3">GTNH Tools</Title>
        </Group>

        <LinkButton variant="subtle" color="gray" to="/">
          Production Lines Planner
        </LinkButton>
      </Group>

      <AccountMenu />
    </Paper>
  );
};
