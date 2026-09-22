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
  <Group gap="xs" align="start" wrap="nowrap">
    {icon ?? <Box w={12} h={12} bg={color} style={{ borderRadius: '50%' }} />}

    {/* the body takes the rest of the row: without this it shrinks to its own
        content and a right-aligned value column stops short of the panel edge */}
    <Box flex={1} miw={0}>
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
