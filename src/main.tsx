import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadMap } from './ui/session';
import './ui/tokens.css';
import './ui/base.css';
import './ui/app.css';

// Open on the real Waterloo map with traffic already moving.
void loadMap('waterloo');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
