interface PdfTextItem {
  str: string
  hasEOL: boolean
}

interface PdfTextPage {
  getTextContent(): Promise<{ items: Array<PdfTextItem | { type: string }> }>
  cleanup(): void
}

interface PdfTextDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfTextPage>
  loadingTask: { destroy(): Promise<void> }
}

export function getDocumentProxy(
  bytes: Uint8Array,
  options: { useSystemFonts: boolean; disableFontFace: boolean },
): Promise<PdfTextDocument>
