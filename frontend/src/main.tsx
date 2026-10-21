import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')
const theme = createTheme({
  palette: {
    primary: { main: '#245fd1' },
    background: { default: '#f5f7fb', paper: '#fff' },
    text: { primary: '#1b2e46', secondary: '#6a7c91' },
    divider: '#e5eaf1',
  },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 7 } },
    },
    MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px' } } },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 700 } } },
  },
})

if (!rootElement) {
  throw new Error('The application root element is missing')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
