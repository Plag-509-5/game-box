/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL publique de l'API Box (ex. https://api.exemple.com/api). Facultatif. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
