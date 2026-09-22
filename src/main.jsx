import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App.jsx';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

// HashRouter: the built app is a folder of static files that works from any static host with no
// server rewrites — there is no server of ours to configure.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
