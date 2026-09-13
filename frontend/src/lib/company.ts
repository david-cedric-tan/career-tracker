import type { Option } from '../components/ui/Combobox'

type Named = { name: string; short_name?: string | null }

/** What the UI calls a company — its short form when one is set. */
export function companyLabel(company: Named): string {
  return company.short_name?.trim() || company.name
}

/**
 * Picker row for a company: the short name and its logo. The full name isn't
 * shown (it's noise in a list) but is still searchable via the hidden hint.
 */
export function companyOption(
  company: Named & { id: number; logo?: string | null },
): Option {
  const label = companyLabel(company)
  return {
    id: company.id,
    label,
    // Searchable but not drawn — see `Option.hintHidden`.
    hint: label === company.name ? undefined : company.name,
    hintHidden: true,
    avatar: company.logo ?? null,
    avatarShape: 'square',
  }
}
