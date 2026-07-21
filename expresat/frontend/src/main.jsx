import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';  /* Theme variables, fonts, body, resets */
import './index.css';          /* Utility classes: glass-panel, buttons, container */

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
