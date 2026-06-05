import { type MantineColor, Group, Box, Text } from '@mantine/core';

interface StatPropsBase {
  label: React.ReactNode;
}

type StatProps =
  | (StatPropsBase & {
      icon: React.ReactNode;
      color?: never;
      value: React.ReactNode;
      children?: never;
    })
  | (StatPropsBase & {
      icon: React.ReactNode;
      color?: never;
      children: React.ReactNode;
      value?: never;
    })
  | (StatPropsBase & {
      color: MantineColor;
      icon?: never;
      value: React.ReactNode;
      children?: never;
    })
  | (StatPropsBase & {
      color: MantineColor;
      icon?: never;
      children: React.ReactNode;
      value?: never;
    });

export const Stat = ({ icon, color, label, value, children }: StatProps) => (
  <Group gap="xs" align="start">
    {icon ?? <Box w={12} h={12} bg={color} style={{ borderRadius: '50%' }} />}

    <Box>
      {typeof label === 'string' ? (
        <Text c="dimmed" size="xs" tt="uppercase" fw={600}>
          {label}
        </Text>
      ) : (
        label
      )}

      {children ?? <Text>{value}</Text>}
    </Box>
  </Group>
);
