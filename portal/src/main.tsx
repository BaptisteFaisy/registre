/* Entry point: mount the portal and load the stylesheets. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/theme.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/widgets.css';
import './styles/screens.css';
import './styles/extensions.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
