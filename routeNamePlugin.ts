import fs from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

const placeHolder = '__COMPONENT_NAME_PLACEHOLDER__';

// Arrow function syntax instead of functions
export const routeTemplate = [
  '%%tsrImports%%',
  '\n\n',
  'const ',
  placeHolder,
  ' = () => { return <div>Hello %%tsrPath%%!</div> };\n\n',
  '%%tsrExportStart%%{\n component: ',
  placeHolder,
  '\n }%%tsrExportEnd%%\n\n',
].join('');

/**
 * This plugin should always come AFTER tanstackRouter()
 *
 * Changes the name of the route component to the capitalized file name and
 * removes trailing commas
 */
const routeComponentName = (): Plugin => {
  return {
    name: 'route-component-rename',
    watchChange(id, { event }) {
      if (event !== 'update' || !id.endsWith('.tsx')) return;

      const routeCode = fs.readFileSync(id, 'utf-8');

      if (!routeCode.includes(placeHolder)) return;

      const fileName = path.basename(id, '.tsx');
      const componentName =
        fileName.replace(/^_+/, '').charAt(0).toUpperCase() +
        fileName.replace(/^_+/, '').substring(1);

      fs.writeFileSync(
        id,
        routeCode
          .replaceAll(placeHolder, componentName)
          .replaceAll(/,\n/g, '\n'),
      );
    },
  };
};

export default routeComponentName;
