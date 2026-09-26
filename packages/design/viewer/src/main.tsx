import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Router } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { DesignViewer } from './app'
import { localSource, STATIC_SITE, staticSource } from './lib/source'
import './lib/theme'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {STATIC_SITE ? (
      // A static site can be served from any folder: it routes by hash.
      <Router hook={useHashLocation} hrefs={(href) => `#${href}`}>
        <DesignViewer source={staticSource} />
      </Router>
    ) : (
      <DesignViewer source={localSource} />
    )}
  </StrictMode>,
)
