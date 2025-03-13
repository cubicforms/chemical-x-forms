import type { Ref } from "vue"

declare module "#app" {
  export function useState<T>(key: string, initialValue?: () => T): Ref<T>
}
