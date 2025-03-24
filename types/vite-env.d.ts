// / <reference types="vite/client" />

declare global {
  interface ImportMeta {
    readonly client: boolean // prevents ts2339 error at dist build time
    readonly server: boolean // prevents ts2339 error at dist build time
    readonly dev: boolean // prevents ts2339 error at dist build time
  }
}

export {}
