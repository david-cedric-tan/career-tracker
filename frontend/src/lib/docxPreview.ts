import mammoth from 'mammoth'

/**
 * Convert a .docx URL into HTML for in-app preview / thumbnails.
 *
 * `preserveFormatting` keeps embedded images and a richer style map for
 * Original mode; Read mode uses mammoth's leaner default HTML.
 */
export async function convertDocxToHtml(
  url: string,
  options: { preserveFormatting?: boolean } = {},
): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load document')
  const buffer = await response.arrayBuffer()

  const convertImage = mammoth.images.imgElement((image) =>
    image.read('base64').then((imageBuffer) => ({
      src: `data:${image.contentType};base64,${imageBuffer}`,
    })),
  )

  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    options.preserveFormatting
      ? {
          convertImage,
          includeDefaultStyleMap: true,
          includeEmbeddedStyleMap: true,
          styleMap: [
            "p[style-name='Title'] => h1.doc-title:fresh",
            "p[style-name='Subtitle'] => h2.doc-subtitle:fresh",
            "r[style-name='Strong'] => strong",
            'u => u',
            'strike => s',
            'comment-reference => sup',
          ],
        }
      : {
          convertImage,
        },
  )
  // Never hand raw converter output to the DOM — see `sanitizeDocumentHtml`.
  return sanitizeDocumentHtml(result.value)
}

/**
 * Strip anything executable out of converted document HTML.
 *
 * Word previews are rendered with `dangerouslySetInnerHTML`, so whatever the
 * converter emits lands in the page as real markup. Mammoth escapes text, but
 * a document still controls its own hyperlinks — a `javascript:` href is one
 * click away from running as us, and a hand-built `.docx` could carry worse.
 * Sanitising here means the viewer only ever renders inert markup, whoever
 * the file came from.
 *
 * Parsed with DOMParser rather than a live element: nothing is attached to
 * the document, so no image ever loads and no handler can fire while we look.
 */
export function sanitizeDocumentHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const node of doc.body.querySelectorAll('script, style, iframe, object, embed, link, meta, form')) {
    node.remove()
  }

  for (const element of doc.body.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      // Every inline handler, whatever it's called.
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'href' || name === 'src' || name === 'xlink:href') {
        // `data:` images are how mammoth embeds pictures, so those stay;
        // every other scheme that can execute goes.
        const safeData = name === 'src' && value.startsWith('data:image/')
        if (!safeData && /^(javascript|vbscript|data|blob|file):/.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }
    }
    // Links out of a document open elsewhere, and must not hand the opener
    // a handle back to this tab.
    if (element.tagName === 'A' && element.getAttribute('href')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noreferrer noopener')
    }
  }

  return doc.body.innerHTML
}
