/// <reference types="vite/client" />

// Brings in Vite's ambient module declarations (e.g. `declare module '*.css'`,
// `import.meta.env`, asset imports) for editors/tsc runs that resolve client
// files against the base tsconfig.json, which doesn't set `types: ["vite/client"]`.
// Without this, side-effect imports like `import './styles.css'` report
// "Cannot find module or type declarations".
