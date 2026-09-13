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
  return result.value
}
