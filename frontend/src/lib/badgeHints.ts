import { formatDate } from './format'

/**
 * The hover text for a stage or outcome badge.
 *
 * Phrased for what the badge means rather than as a bare date: a stage is
 * somewhere you *are* ("since"), while a terminal outcome is something that
 * *happened* ("on"). Falls back to the plain label when there's no timestamp,
 * so a badge never hovers to an empty bubble.
 */
export function stageHint(label: string, since: string | null): string {
  if (!since) return `Stage: ${label}`
  return `In ${label} since ${formatDate(since.slice(0, 10))}`
}

export function outcomeHint(
  label: string,
  outcome: string,
  changedAt: string | null,
): string {
  if (outcome === 'in_progress') {
    return changedAt
      ? `In Progress since ${formatDate(changedAt.slice(0, 10))}`
      : 'Still in progress'
  }
  if (!changedAt) return label
  return `${label} on ${formatDate(changedAt.slice(0, 10))}`
}
