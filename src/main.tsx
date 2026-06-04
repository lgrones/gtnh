import 'core-js/actual/iterator'; // Polyfill for iterator functions

import { createRoot } from 'react-dom/client';

import App from './app';

const rootElement = document.getElementById('root');

if (!rootElement) throw new Error('No root element was found in the DOM');

const root = createRoot(rootElement);

root.render(<App />);
