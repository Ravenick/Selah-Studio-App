import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { setBaseUrl } from '@workspace/api-client-react';
import { isTauri } from '@tauri-apps/api/core';

import './index.css';

const apiBase = isTauri() && !import.meta.env.DEV
  ? import.meta.env.VITE_TAURI_API_BASE_URL
  : import.meta.env.VITE_API_BASE_URL;
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
