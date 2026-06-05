import '@mantine/core/styles.css';
import '@mantine/nprogress/styles.css';
import '@xyflow/react/dist/style.css';
import './index.css';

import { Group, MantineProvider, Paper } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';

import { createRouterConfig } from '@/infrastructure/router';

const router = createRouterConfig();

const App = () => {
  return (
    <StrictMode>
      <MantineProvider
        defaultColorScheme="dark"
        theme={{
          primaryColor: 'indigo',
          components: {
            Paper: Paper.extend({
              defaultProps: { bg: 'dark.9', withBorder: true },
            }),
            Group: Group.extend({ defaultProps: { wrap: 'nowrap' } }),
          },
        }}
      >
        <ModalsProvider>
          <RouterProvider router={router} />
        </ModalsProvider>
      </MantineProvider>
    </StrictMode>
  );
};

export default App;
