/// <reference types="vite/client" />

/** Public application settings injected by Vite and the workshop env generator. */
interface ImportMetaEnv {
  readonly VITE_API_MODE?: string
  readonly VITE_API_URL?: string
  readonly VITE_API_ENDPOINTS?: string
}
