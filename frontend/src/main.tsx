import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyGlass, readGlass } from './lib/glass'

// Painted before the first render so a glassy UI doesn't flash solid on load.
applyGlass(readGlass())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
