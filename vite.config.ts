import babel from '@rolldown/plugin-babel';
import tanstackRouter from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import tsconfigPaths from 'vite-tsconfig-paths';

import routeComponentName, { routeTemplate } from './routeNamePlugin';

// split the vendor bundle by library so no single chunk dominates the initial
// load. elkjs is intentionally excluded — it's one atomic ~1.4MB module that's
// already dynamically imported (loads only on auto-layout), so leave it alone.
const vendorChunk = (id: string): string | undefined => {
  if (!id.includes('node_modules') || id.includes('elkjs')) return undefined;

  if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';

  if (id.includes('@firebase') || /[\\/]firebase[\\/]/.test(id))
    return 'firebase';

  if (id.includes('@mantine') || id.includes('@tabler')) return 'ui';

  if (id.includes('@xyflow')) return 'xyflow';

  if (id.includes('yjs') || id.includes('y-protocols') || id.includes('lib0'))
    return 'yjs';

  return 'vendor';
};

export default defineConfig({
  build: { rollupOptions: { output: { manualChunks: vendorChunk } } },
  resolve: {
    alias: {
      '@tabler/icons-react': '@tabler/icons-react/dist/esm/icons/index.mjs',
    },
    // TODO: flip to true and remove vite-tsconfig-paths once this merged https://github.com/oxc-project/oxc-resolver/pull/1081
    tsconfigPaths: false,
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      semicolons: true,
      customScaffolding: { routeTemplate },
      routeToken: 'layout',
      generatedRouteTree: 'src/infrastructure/routeTree.gen.ts',
    }),
    routeComponentName(),
    mkcert(),
    tsconfigPaths({ projects: ['./tsconfig.app.json'] }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
