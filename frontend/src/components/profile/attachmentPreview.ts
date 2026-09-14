import type { ProfileAttachment } from '../../api/types'
import type { PreviewSource } from '../../lib/documentPreview'

/** A profile attachment as the shared viewer/thumbnail shape. */
export function attachmentPreview(attachment: ProfileAttachment): PreviewSource {
  return {
    file: attachment.file,
    title: attachment.caption || attachment.original_name || 'Attachment',
    original_name: attachment.original_name || null,
    kind: attachment.kind,
    created_at: attachment.created_at,
  }
}

