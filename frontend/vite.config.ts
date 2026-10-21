import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TypeScript configuration for the local Vite development server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
  },
})
