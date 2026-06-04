import { MantineProvider } from '@mantine/core';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';

import { createRouterConfig } from '@/infrastructure/router';

const router = createRouterConfig();

const App = () => {
  return (
    <StrictMode>
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>
    </StrictMode>
  );
};

export default App;
