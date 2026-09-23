/** API base URL, e.g. https://api.example.com/api/v1. `null` means demo-only mode. */
export const API_URL: string | null = normalise(import.meta.env.VITE_API_URL)

function normalise(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, '')
}

export const DEMO_BASE = `${import.meta.env.BASE_URL}demo/`

export function apiHost(): string {
  if (!API_URL) return 'no backend configured'
  try {
    return new URL(API_URL).host
  } catch {
    return API_URL
  }
}
