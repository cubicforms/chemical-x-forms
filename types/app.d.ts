/* eslint-disable @stylistic/semi */

import type { Ref } from "vue";

// types/app.d.ts
declare module "#app" {

  export function useState<T>(key: string, initialValue?: () => T): Ref<T>
}

export { };
