import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    const hadController = Boolean(navigator.serviceWorker.controller)
    const removed = (await Promise.all(registrations.map((registration) => registration.unregister()))).some(Boolean)
    if (hadController && removed && !sessionStorage.getItem('dance-sw-reset')) {
      sessionStorage.setItem('dance-sw-reset', 'done')
      window.location.reload()
    }
  })
}
