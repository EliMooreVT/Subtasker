import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ServiceProvider } from './ServiceContext';
import { DesktopService } from '../../desktop/DesktopService';
import './styles.css';

const service = new DesktopService();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ServiceProvider service={service}>
      <App />
    </ServiceProvider>
  </React.StrictMode>
);
