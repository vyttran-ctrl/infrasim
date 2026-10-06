import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useApp } from './app/store';
import { buildGrid } from './net';
import './ui/tokens.css';
import './ui/base.css';
import './ui/app.css';

useApp.getState().loadNetwork(buildGrid(), 'grid');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
