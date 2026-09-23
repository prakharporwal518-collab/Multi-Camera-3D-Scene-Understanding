import { useEffect, useState } from 'react'

/**
 * useState backed by localStorage for per-viewer conveniences (viewer toggles, point size).
 * Storage can be unavailable (private mode, blocked cookies); the state then simply is not kept.
 */
export function usePersistentState<T>(key: string, initial: T, validate?: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initial
      const parsed: unknown = JSON.parse(raw)
      if (validate && !validate(parsed)) return initial
      if (!validate && typeof parsed !== typeof initial) return initial
      return parsed as T
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage full or unavailable: keep working without persistence */
    }
  }, [key, value])

  return [value, setValue] as const
}
