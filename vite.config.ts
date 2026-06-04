import babel from '@rolldown/plugin-babel';
import tanstackRouter from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import tsconfigPaths from 'vite-tsconfig-paths';

import routeComponentName, { routeTemplate } from './routeNamePlugin';

export default defineConfig({
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
