import { useEffect, useState } from 'react'
import { ImagePicker } from '../ui/ImagePicker'

type IconRow = { id: number; icon: string | null }
type IconApi<T extends IconRow> = {
  uploadIcon: (id: number, file: File) => Promise<T>
  removeIcon: (id: number) => Promise<T>
}

/**
 * The identifying image on a profile section row (school crest, issuer
 * logo, club badge). For a row that exists it uploads straight away; for one
 * being created it holds the file and previews it, and the form sends it
 * once the row has an id — the same dance Education did, shared so
 * Certifications and Extra-curriculars behave identically.
 */
export function SectionIconPicker<T extends IconRow>({
  name,
  label,
  helpText,
  row,
  api,
  onRowChange,
  onPending,
}: {
  name: string
  label: string
  helpText?: string
  row: T | null
  api: IconApi<T>
  onRowChange: (saved: T) => void
  /** The file waiting for the row to be created, or null. */
  onPending: (file: File | null) => void
}) {
  const [pending, setPending] = useState<File | null>(null)
  const preview = pending ? URL.createObjectURL(pending) : null
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const src = preview ?? row?.icon ?? null

  return (
    <ImagePicker
      name={name}
      src={src}
      size="lg"
      shape="square"
      label={label}
      helpText={helpText}
      onUpload={async (file) => {
        if (row) {
          onRowChange(await api.uploadIcon(row.id, file))
          setPending(null)
          onPending(null)
        } else {
          setPending(file)
          onPending(file)
        }
      }}
      onRemove={
        src
          ? async () => {
              if (row?.icon) onRowChange(await api.removeIcon(row.id))
              setPending(null)
              onPending(null)
            }
          : undefined
      }
    />
  )
}
