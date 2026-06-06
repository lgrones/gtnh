import { Alert, Button, PasswordInput, Stack } from '@mantine/core';
import { hasLength, isNotEmpty, matchesField, useForm } from '@mantine/form';
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

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { password: '', newPassword: '', confirmNewPassword: '' },
    validate: {
      password: isNotEmpty('No old password supplied'),
      newPassword: hasLength(
        { min: 6 },
        'New password must be at least 6 characters',
      ),
      confirmNewPassword: matchesField(
        'newPassword',
        'New passwords do not match',
      ),
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values: typeof form.values) => {
    setError(null);
    setSubmitting(true);

    try {
      await changePassword(values.password, values.newPassword);
      onDone();
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';

      setError(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'Current password is incorrect'
          : 'Could not change password. Please try again',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
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
          {...form.getInputProps('password')}
          key={form.key('password')}
        />
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          required
          {...form.getInputProps('newPassword')}
          key={form.key('newPassword')}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          required
          {...form.getInputProps('confirmNewPassword')}
          key={form.key('confirmNewPassword')}
        />

        <Button type="submit" loading={submitting} fullWidth>
          Change password
        </Button>
      </Stack>
    </form>
  );
};
