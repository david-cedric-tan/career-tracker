import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { readThumbnail, writeThumbnail } from './thumbnailCache'

type PdfJs = typeof import('pdfjs-dist')

let pdfJsReady: Promise<PdfJs> | null = null

/** Lazy-load pdf.js and wire the worker once. */
export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfJsReady) {
    pdfJsReady = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })
  }
  return pdfJsReady
}

/**
 * The first page as a JPEG data URL — cached, so anything after the first
 * render of a given file is instant (see `thumbnailCache`).
 */
export async function renderPdfThumbnail(url: string, maxWidth = 280): Promise<string> {
  const cached = await readThumbnail(url)
  if (cached) return cached
  const dataUrl = await drawFirstPage(url, maxWidth)
  void writeThumbnail(url, dataUrl)
  return dataUrl
}

async function drawFirstPage(url: string, maxWidth: number): Promise<string> {
  const pdfjs = await loadPdfJs()
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`Could not load PDF (${response.status})`)
  const data = await response.arrayBuffer()
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = maxWidth / baseViewport.width
    const viewport = page.getViewport({ scale })

    const scratch = document.createElement('canvas')
    scratch.width = viewport.width
    scratch.height = viewport.height
    const scratchContext = scratch.getContext('2d')
    if (!scratchContext) throw new Error('No canvas context')
    await page.render({ canvasContext: scratchContext, viewport, canvas: scratch }).promise
    // JPEG at this size is ~20–40KB — cheap to keep, and the card shows it
    // scaled down anyway.
    return scratch.toDataURL('image/jpeg', 0.82)
  } finally {
    void task.destroy()
  }
}
