import type { ApplicationChoices } from '../api/types'

/**
 * True only when the stage moved *later* in the pipeline.
 *
 * The choice list arrives in pipeline order, so its index is the ordering — a
 * rollback, or an edit that leaves the stage alone, must not set off
 * fireworks (FR-FX-03).
 */
export function movedForward(
  before: string,
  after: string,
  choices: ApplicationChoices | null,
): boolean {
  const order = choices?.stage.map((choice) => choice.value) ?? []
  const from = order.indexOf(before)
  const to = order.indexOf(after)
  return from >= 0 && to >= 0 && to > from
}
