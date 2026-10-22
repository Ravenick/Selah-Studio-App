import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { setBaseUrl } from '@workspace/api-client-react';
import { isTauri } from '@tauri-apps/api/core';

import './index.css';

// In dev, use Vite's same-origin /api proxy. This also works when the app is
// opened from another device on the LAN; a baked-in localhost URL points there
// to the visitor's computer instead of the machine hosting the API.
const apiBase = import.meta.env.DEV
  ? undefined
  : isTauri()
    ? import.meta.env.VITE_TAURI_API_BASE_URL?.trim() || import.meta.env.VITE_API_BASE_URL?.trim()
    : import.meta.env.VITE_API_BASE_URL?.trim();
const configuredApiBase = apiBase?.trim().replace(/\/+$/, '');
if (configuredApiBase) setBaseUrl(configuredApiBase);

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
