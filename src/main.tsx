import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './visual-tuning.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').then((registration) => {
      const announce = () => window.dispatchEvent(new Event('wms-mini:update-ready'));
      if (registration.waiting) announce();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announce();
        });
      });
      void registration.update().catch(() => undefined);
    }).catch(() => undefined);
    // Do not force activation or reload a live warehouse form. A waiting version
    // activates naturally after all clients of the old version have closed.
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
