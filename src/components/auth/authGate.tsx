import {
  Button,
  Center,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconBrandGoogle } from '@tabler/icons-react';
import { type ReactNode } from 'react';

import { useAuth } from '@/contexts/auth';

// gates the app behind Google sign-in. children render only once a user is
// authenticated — every collaborator needs an identity for presence + sharing
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const user = useAuth(state => state.user);
  const loading = useAuth(state => state.loading);
  const signIn = useAuth(state => state.signIn);

  if (loading)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );

  if (user) return children;

  return (
    <Center h="100vh">
      <Paper p="xl" component={Stack} gap="lg" align="center" maw={360}>
        <Title order={2}>GTNH Planner</Title>
        <Text c="dimmed" ta="center" size="sm">
          Sign in to create, edit, and collaborate on production lines.
        </Text>
        <Button
          leftSection={<IconBrandGoogle size={18} />}
          onClick={() => void signIn()}
        >
          Sign in with Google
        </Button>
      </Paper>
    </Center>
  );
};
