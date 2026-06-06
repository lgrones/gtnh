import {
  Alert,
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { type ReactNode, useState } from 'react';

import { useAuth } from '@/contexts/auth';

// gates the app behind email/password sign-in. There is no sign-up form on
// purpose — accounts are created by hand in the Firebase console, so only
// people added manually can get in. children render only once authenticated.
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const user = useAuth(state => state.user);
  const loading = useAuth(state => state.loading);
  const signIn = useAuth(state => state.signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch {
      // don't leak whether the email exists — one generic message for any
      // wrong-credentials / disabled-account / not-found failure
      setError('Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );

  if (user) return children;

  return (
    <Center h="100vh">
      <Paper
        p="xl"
        component="form"
        onSubmit={event => {
          event.preventDefault();
          void handleSubmit();
        }}
        maw={360}
        w="100%"
      >
        <Stack gap="lg">
          <Stack gap={4} align="center">
            <Title order={2}>GTNH Planner</Title>
            <Text c="dimmed" ta="center" size="sm">
              Sign in to create, edit, and collaborate on production lines
            </Text>
          </Stack>

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
          />

          <Button type="submit" loading={submitting} fullWidth>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
};
