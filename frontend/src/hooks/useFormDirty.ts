import { useMemo, useRef } from 'react'

/**
 * Compare the live form value to the snapshot taken when the dialog opened
 * (or when `resetKey` changes). Used to drive Modal's `dirty` discard prompt.
 */
export function useFormDirty<T>(value: T, resetKey?: string | number | null): boolean {
  const baseline = useRef(value)
  const keyRef = useRef(resetKey)

  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey
    baseline.current = value
  }

  return useMemo(() => !stableEqual(value, baseline.current), [value])
}

/** Mark the current value as the clean baseline (call after a successful save
    if the dialog stays open). */
export function snapshotFormDirty<T>(holder: { current: T }, value: T) {
  holder.current = value
}

function stableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
