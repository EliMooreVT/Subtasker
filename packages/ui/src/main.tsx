import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ServiceProvider } from './ServiceContext';
import { DesktopService } from '../../desktop/DesktopService';
import { MobileService } from '../../mobile/MobileService';
import './styles.css';

// On iOS the Swift bridge injects window.subtasker via BridgeShim.js and also
// exposes window.webkit.messageHandlers.subtasker — use that as the platform flag.
const isIOS = !!(window as any).webkit?.messageHandlers?.subtasker;
const service = isIOS ? new MobileService() : new DesktopService();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ServiceProvider service={service}>
      <App />
    </ServiceProvider>
  </React.StrictMode>
);
