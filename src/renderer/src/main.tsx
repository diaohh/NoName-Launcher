import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Self-hosted: Vite emits the woff2 files as local assets, so the CSP needs nothing beyond
// the "font-src 'self'" it already has. Pulling them from fonts.googleapis.com was blocked
// outright by "style-src", which is why no custom font ever rendered.
import '@fontsource-variable/inter'
import './App.css'

// index.html carries it; without it there is nothing to render into.
const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
