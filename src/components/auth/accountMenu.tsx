import { Avatar, Button, Menu } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconChevronDown,
  IconKey,
  IconLogout,
  IconUserCircle,
} from '@tabler/icons-react';
import { useShallow } from 'zustand/shallow';

import { useAuth } from '@/contexts/auth';

import { ChangePasswordModalContent } from './changePasswordModal';

const openChangePasswordModal = () => {
  const id = modals.open({
    title: 'Change password',
    children: <ChangePasswordModalContent onDone={() => modals.close(id)} />,
  });
};

// signed-in user's account controls: change password + log out. Lives in the
// library panel footer so it's always reachable without its own chrome.
export const AccountMenu = () => {
  const { displayName, photo, signOut } = useAuth(
    useShallow(state => ({
      displayName: state.user?.displayName ?? state.user?.email,
      photo: state.user?.photoURL,
      signOut: state.signOut,
    })),
  );

  if (!displayName) return null;

  return (
    <Menu position="top-start" withinPortal>
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          rightSection={<IconChevronDown size={16} />}
          px={0}
          h={38}
        >
          <Avatar src={photo} size={36}>
            <IconUserCircle size={36} strokeWidth={1.5} />
          </Avatar>
        </Button>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconKey size={16} />}
          onClick={openChangePasswordModal}
        >
          Change password
        </Menu.Item>
        <Menu.Item
          color="red"
          leftSection={<IconLogout size={16} />}
          onClick={() => void signOut()}
        >
          Log out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
