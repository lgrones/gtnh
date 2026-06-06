import { Alert, Button, PasswordInput, Stack } from '@mantine/core';
import { useState } from 'react';

import { useAuth } from '@/contexts/auth';

// modal body for changing the signed-in user's password. Reauthentication is
// handled in the auth store; here we just collect input and surface failures.
// onDone closes the host modal once the change succeeds.
export const ChangePasswordModalContent = ({
  onDone,
}: {
  onDone: () => void;
}) => {
  const changePassword = useAuth(state => state.changePassword);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);

    if (next.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(current, next);
      onDone();
    } catch (err) {
      // wrong current password is the common case; reauth rejects it
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      setError(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'Current password is incorrect.'
          : 'Could not change password. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          required
          value={current}
          onChange={e => setCurrent(e.currentTarget.value)}
        />
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          required
          value={next}
          onChange={e => setNext(e.currentTarget.value)}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={e => setConfirm(e.currentTarget.value)}
        />

        <Button type="submit" loading={submitting} fullWidth>
          Change password
        </Button>
      </Stack>
    </form>
  );
};
