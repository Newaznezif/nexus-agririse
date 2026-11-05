'use client';

import type { PdfUnicodeFont } from '@/services/pdfExport';

/**
 * The one font this product embeds into a PDF when its standard fonts cannot hold the script, and how
 * the browser gets its bytes.
 *
 * Abyssinica SIL is under the SIL Open Font License 1.1 — the licence text ships beside the file at
 * `public/fonts/LICENSE-abyssinica.txt`, and the file is unmodified from SIL's release 2.300. It was
 * chosen because it carries Ge'ez script *and* Basic Latin + Latin-1 in one face, so a label that
 * mixes Amharic with a Latin unit abbreviation renders whole instead of half-substituted.
 *
 * `extraRanges` is measured from that exact file's cmap, not from what one would like it to cover:
 * Ethiopic (U+1200–U+137C) and Ethiopic Supplement (U+1380–U+1399). Anything outside those ranges and
 * outside WinAnsi is not claimed to render — the exporter says so on the page instead.
 */
export const ABYSSINICA_FONT: Omit<PdfUnicodeFont, 'base64'> = {
  fileName: 'AbyssinicaSIL-Regular.ttf',
  postScriptName: 'AbyssinicaSIL',
  extraRanges: [[0x1200, 0x1399]],
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // One String.fromCharCode over 268k bytes can blow the argument limit; 8k at a time cannot.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
};

let loading: Promise<PdfUnicodeFont | null> | null = null;

/**
 * The font bytes, fetched once per session and only when an export actually needs them: a report in
 * Latin script never pays for a 268 kB download, and jsPDF subsets what it embeds to the glyphs used.
 * A failed load is not a failed export — the exporter falls back to disclosing any character it
 * cannot draw rather than dropping it.
 */
export const loadUnicodeFont = (): Promise<PdfUnicodeFont | null> => {
  loading ??= (async () => {
    try {
      const response = await fetch(`/fonts/${ABYSSINICA_FONT.fileName}`);
      if (!response.ok) return null;
      const base64 = toBase64(new Uint8Array(await response.arrayBuffer()));
      return { ...ABYSSINICA_FONT, base64 };
    } catch {
      return null;
    }
  })();
  return loading;
};
