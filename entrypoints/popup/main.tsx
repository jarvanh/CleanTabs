import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';
import { Provider } from '@/components/Providers';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider>
      <App />
    </Provider>
  </React.StrictMode>,
);
