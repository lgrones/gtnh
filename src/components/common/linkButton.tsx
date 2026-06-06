import { Button, type ButtonProps } from '@mantine/core';
import { createLink, type LinkComponent } from '@tanstack/react-router';
import React from 'react';

interface MantineProps extends ButtonProps {}

const MantineLinkComponent = React.forwardRef<HTMLAnchorElement, MantineProps>(
  (props, ref) => {
    return <Button component="a" ref={ref} {...props} />;
  },
);

const CreatedLinkComponent = createLink(MantineLinkComponent);

export const LinkButton: LinkComponent<typeof MantineLinkComponent> = props => {
  return <CreatedLinkComponent preload="intent" {...props} />;
};
