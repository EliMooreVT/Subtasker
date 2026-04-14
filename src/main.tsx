import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ServiceProvider, createWindowAdapter } from './ServiceContext';
import './styles.css';

const service = createWindowAdapter();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ServiceProvider service={service}>
      <App />
    </ServiceProvider>
  </React.StrictMode>
);
