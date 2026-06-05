import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { emailKey, type GraphRole } from '@/contexts/productionLibrary';
import { db } from '@/infrastructure/firebase';

type ShareRole = Exclude<GraphRole, 'owner'>;

interface ShareDoc {
  roles?: Record<string, GraphRole>;
  invites?: Record<string, GraphRole>;
}

const graphRef = (graphId: string) => doc(db, 'graphs', graphId);

export const ShareModalContent = ({ graphId }: { graphId: string }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('editor');
  const [roles, setRoles] = useState<Record<string, GraphRole>>({});
  const [invites, setInvites] = useState<Record<string, GraphRole>>({});

  // live view of the graph's sharing state
  useEffect(
    () =>
      onSnapshot(graphRef(graphId), snap => {
        const data = snap.data() as ShareDoc | undefined;
        setRoles(data?.roles ?? {});
        setInvites(data?.invites ?? {});
      }),
    [graphId],
  );

  const invite = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    await updateDoc(graphRef(graphId), {
      [`invites.${emailKey(clean)}`]: role,
      inviteEmails: arrayUnion(clean),
    });
    setEmail('');
  };

  const revokeInvite = async (encodedEmail: string) => {
    await updateDoc(graphRef(graphId), {
      [`invites.${encodedEmail}`]: deleteField(),
      inviteEmails: arrayRemove(atob(encodedEmail)),
    });
  };

  const removeMember = async (uid: string) => {
    await updateDoc(graphRef(graphId), {
      [`roles.${uid}`]: deleteField(),
      memberIds: arrayRemove(uid),
    });
  };

  const changeRole = async (uid: string, next: ShareRole) => {
    await updateDoc(graphRef(graphId), { [`roles.${uid}`]: next });
  };

  return (
    <Stack gap="md">
      <Group align="end" gap="xs">
        <TextInput
          flex={1}
          label="Invite by email"
          placeholder="collaborator@example.com"
          type="email"
          value={email}
          onChange={e => setEmail(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void invite();
          }}
        />
        <Select
          w={110}
          data={['editor', 'viewer']}
          value={role}
          onChange={value => {
            if (value) setRole(value as ShareRole);
          }}
          allowDeselect={false}
        />
        <Button onClick={() => void invite()}>Invite</Button>
      </Group>

      {Object.keys(roles).length > 0 && (
        <>
          <Divider label="Members" />
          {Object.entries(roles).map(([uid, memberRole]) => (
            <Group key={uid} justify="space-between" gap="xs">
              <Text size="sm" truncate flex={1}>
                {uid}
              </Text>
              <Select
                w={110}
                data={['editor', 'viewer']}
                value={memberRole}
                onChange={value => {
                  if (value) void changeRole(uid, value as ShareRole);
                }}
                allowDeselect={false}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Remove member"
                onClick={() => void removeMember(uid)}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
          ))}
        </>
      )}

      {Object.keys(invites).length > 0 && (
        <>
          <Divider label="Pending invites" />
          {Object.entries(invites).map(([encoded, inviteRole]) => (
            <Group key={encoded} justify="space-between" gap="xs">
              <Text size="sm" truncate flex={1}>
                {atob(encoded)}
              </Text>
              <Text size="xs" c="dimmed">
                {inviteRole}
              </Text>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Revoke invite"
                onClick={() => void revokeInvite(encoded)}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
          ))}
        </>
      )}
    </Stack>
  );
};
