import { nprogress } from '@mantine/nprogress';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export const createRouterConfig = () => {
  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  router.subscribe('onBeforeNavigate', nprogress.start);

  router.subscribe('onResolved', nprogress.complete);

  return router;
};

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouterConfig>;
  }
}
