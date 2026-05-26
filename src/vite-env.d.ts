/// <reference types="vite/client" />

declare module '*.jsonc' {
  const value: unknown;
  export default value;
}
