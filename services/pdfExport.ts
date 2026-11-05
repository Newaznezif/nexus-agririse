/**
 * The drawing half of the evidence PDF.
 *
 * Everything on the page arrives from `lib/report/pdfDocument.ts` as a typed block: this file picks
 * a font, a colour and a coordinate for each block kind, and nothing else. It contains no sentence
 * about the data, no figure, no date and no source name — so the only way a number can reach the
 * page is by already being in the bundle or in the validated interpretation.
 *
 * The one thing it does decide about text is which typeface can hold it. jsPDF's standard fonts are
 * WinAnsi, so an Amharic market name or a caller's display name in Ge'ez script cannot be drawn with
 * them; the previous export dropped such characters silently. Now a string outside WinAnsi is drawn
 * with the embedded Unicode font when that font holds it, and when nothing holds it the character is
 * replaced by a visible marker and listed in a note at the end of the file — never quietly deleted.
 * That note is the only sentence this layer writes, and it is about typography, not about the data.
 *
 * The layout is the report's existing visual identity: A4 millimetres, 25 mm margins, the light page
 * frame, the emerald cover band with the logo, the 42 pt display title over a 2 mm rule, the grey
 * cover box, the same `plain`/`grid`/`striped` table themes with emerald and blue headings, the same
 * chart area size and the `Page i of N` footer.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Dataset, Insight } from '@/types';
import {
  buildEvidencePdf,
  buildRecordPdf,
  type EvidencePdfInput,
  type PdfBlock,
  type PdfChartBlock,
  type PdfColor,
  type PdfDocument,
  type PdfNoChartDataBlock,
  type PdfTableBlock,
} from '@/lib/report/pdfDocument';

/**
 * A font the caller has already read, so this module never touches the network or the disk.
 *
 * `extraRanges` is not a wish list: it is the code points measured out of the cmap of the exact file
 * shipped at `fileName` (Abyssinica SIL, SIL Open Font License — see
 * `public/fonts/LICENSE-abyssinica.txt`), beyond the Basic Latin and Latin-1 ranges that file also
 * carries, which is why a string mixing Ge'ez script with Latin renders whole.
 */
export interface PdfUnicodeFont {
  /** Key the font bytes are registered under in jsPDF's virtual file system. */
  fileName: string;
  /** PostScript name jsPDF uses to select it. */
  postScriptName: string;
  base64: string;
  /** Code points this file holds that WinAnsi does not, as inclusive [first, last] pairs. */
  extraRanges: [number, number][];
}

export type PdfResult = { blob: Blob; filename: string; unrendered: string[] };

/**
 * The font, or a caller that can go and get it. A function is passed when the bytes are not already
 * in hand: the document is built first, and only a report that actually asks for a script the base
 * fonts cannot hold triggers the download.
 */
export type UnicodeFontSource = PdfUnicodeFont | null | (() => Promise<PdfUnicodeFont | null>);

const withFont = async (model: PdfDocument, source: UnicodeFontSource): Promise<PdfResult> =>
  renderDocument(model, typeof source === 'function' ? (documentNeedsUnicodeFont(model) ? await source() : null) : source);

/** The Phase 5 export: the bundle the panel is showing, plus the interpretation for that bundle. */
export const generateEvidencePdf = async (
  input: EvidencePdfInput,
  unicodeFont: UnicodeFontSource = null,
): Promise<PdfResult> => withFont(buildEvidencePdf(input), unicodeFont);

/**
 * The stored-analysis export. It keeps the call signature the dashboard component already uses, but
 * the document is built by `buildRecordPdf`: no charts, no auth code, no signature line, and a page
 * that states the record carries no publisher evidence.
 */
export const generatePDFReport = async (
  dataset: Dataset,
  insight: Insight,
  generatorName: string = 'Nexus AgriRise',
  generatorRole: string = 'Analyst',
  unicodeFont: UnicodeFontSource = null,
): Promise<PdfResult> =>
  withFont(
    buildRecordPdf({
      datasetName: dataset.name,
      datasetCountry: dataset.country ?? null,
      insightId: insight.id,
      summary: insight.summary,
      riskLevel: insight.risk_level,
      trend: insight.trend,
      createdAt: insight.created_at ?? null,
      requestedBy: generatorName,
      requestedRole: generatorRole,
    }),
    unicodeFont,
  );

const MARGIN = 25;
const PRIMARY: PdfColor = [5, 150, 105]; // Emerald-600
const SECONDARY: PdfColor = [31, 41, 55]; // Zinc-800
const MUTED: PdfColor = [100, 100, 100];
const FRAME_COLOUR: PdfColor = [240, 240, 240];
const GRID: PdfColor = [230, 230, 230];
const AXIS: PdfColor = [200, 200, 200];
const BOX_FILL: PdfColor = [249, 250, 251];
const ALERT: PdfColor = [220, 38, 38];
const FOOTER_GREY: PdfColor = [156, 163, 175];

/** The palette the old fabricated pie used, now assigned to real series in order. */
const SERIES_COLORS: PdfColor[] = [PRIMARY, [59, 130, 246], [217, 119, 6], [124, 58, 237], [16, 185, 129]];

const CHART_HEIGHT = 40;
const CONTENT_TOP = 30;
/** A demo page carries its notice band inside the frame, so its text starts lower. */
const DEMO_TOP = 36;

/** True when a string in the document needs the Unicode font — so a caller only fetches it if it must. */
export const documentNeedsUnicodeFont = (model: PdfDocument): boolean =>
  documentStrings(model).some((value) => !isWinAnsi(value));

/** Draw a document. `unicodeFont` is only needed when `documentNeedsUnicodeFont` says the text asks for it. */
export const renderDocument = async (model: PdfDocument, unicodeFont: PdfUnicodeFont | null): Promise<PdfResult> => {
  const doc = new jsPDF();
  const fontId = unicodeFont ? registerFont(doc, unicodeFont) : null;
  /** Every character this file's fonts could not hold, gathered to be disclosed rather than lost. */
  const unrendered = new Set<string>();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const contentBottom = pageHeight - 32;
  const firstContentRow = model.demoNotice ? DEMO_TOP : CONTENT_TOP;
  let y = firstContentRow;

  const ink = (c: PdfColor) => doc.setTextColor(c[0], c[1], c[2]);
  const paint = (c: PdfColor) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: PdfColor) => doc.setDrawColor(c[0], c[1], c[2]);

  /**
   * The typeface decision is made per string, and the style the caller asked for is remembered so a
   * run in the embedded font hands the page back to Helvetica afterwards. The embedded file is a
   * single weight: a bold heading that needs Ge'ez script keeps its size and colour and loses its
   * weight rather than its letters.
   */
  let style: 'normal' | 'bold' = 'normal';
  const setStyle = (next: 'normal' | 'bold') => {
    style = next;
    doc.setFont('helvetica', next);
  };
  const typeface = (unicode: boolean) => {
    if (unicode && fontId !== null) doc.setFont(fontId, 'normal');
    else doc.setFont('helvetica', style);
  };

  /** A string as this file can draw it: the text to set, and whether the embedded font must carry it. */
  const fit = (value: string): { text: string; unicode: boolean } => {
    const cleaned = value.replace(/\r?\n/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
    if (isWinAnsi(cleaned)) return { text: cleaned, unicode: false };
    let out = '';
    let unicode = false;
    for (const char of cleaned) {
      if (isWinAnsi(char)) out += char;
      else if (char in GLYPH_FALLBACK) out += GLYPH_FALLBACK[char];
      else if (fontHolds(unicodeFont, char)) { out += char; unicode = true; }
      else { out += '[?]'; unrendered.add(codePointName(char)); }
    }
    return { text: out.replace(/\s{2,}/g, ' ').trim(), unicode };
  };

  /** Draw one string, choosing the font that holds it. */
  const text = (value: string, x: number, at: number, options?: { align?: 'left' | 'center' | 'right'; maxWidth?: number }) => {
    const fitted = fit(value);
    typeface(fitted.unicode);
    doc.text(fitted.text, x, at, options);
    typeface(false);
  };

  /** Split a string to a width, measuring with the font that will draw it. */
  const wrap = (value: string, width: number) => {
    const fitted = fit(value);
    typeface(fitted.unicode);
    const lines = doc.splitTextToSize(fitted.text, width) as string[];
    typeface(false);
    return lines;
  };

  const measure = (value: string): number => {
    const fitted = fit(value);
    typeface(fitted.unicode);
    const width = doc.getTextWidth(fitted.text);
    typeface(false);
    return width;
  };

  /** The font a table's cells need, so one table is set in one typeface rather than half in each. */
  const tableFont = (cells: string[][]): string | null =>
    cells.flat().some((value) => fit(value).unicode) && fontId !== null ? fontId : null;

  /** A cell's text as this file can draw it; `tableFont` has already chosen the typeface for it. */
  const fitted = (value: string): string => fit(value).text;

  const frame = () => {
    stroke(FRAME_COLOUR);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20);
  };

  const newPage = () => {
    doc.addPage();
    frame();
    y = firstContentRow;
  };

  /** Reserve vertical space before committing to a block, so a caption never splits from its chart. */
  const ensure = (mm: number) => {
    if (y + mm > contentBottom) newPage();
  };

  /* ----------------------------------------------------------------- cover ----------------------------------------------------------------- */

  frame();
  paint(PRIMARY);
  doc.rect(0, 0, pageWidth, 60, 'F');

  const logo = await loadLogo();
  // The wordmark sits where the logo image would have ended. When the file cannot be fetched —
  // which is every render outside a browser — the text mark takes its place, and the wordmark has
  // to clear the width it actually drew rather than a fixed 25 pt that only fitted the image.
  let wordmarkX = MARGIN + 25;
  if (logo) doc.addImage(logo, 'JPEG', MARGIN, 12, 20, 20);
  else {
    doc.setTextColor(255, 255, 255);
    setStyle('bold');
    doc.setFontSize(24);
    doc.text('NEXUS', MARGIN, 28);
    wordmarkX = MARGIN + measure('NEXUS') + 12;
  }

  doc.setTextColor(255, 255, 255);
  setStyle('bold');
  doc.setFontSize(16);
  doc.text('NEXUS AGRIRISE', wordmarkX, 25);
  doc.setFontSize(10);
  setStyle('normal');
  doc.text('AFRICA INTELLIGENCE SYSTEM', wordmarkX, 31);

  ink(SECONDARY);
  doc.setFontSize(42);
  setStyle('bold');
  // 42 pt is the display size the previous cover set for its two short lines. A title the bundle
  // writes is fitted to the same column instead of run past the frame.
  let titleSize = 42;
  while (titleSize > 20 && model.cover.title.some((line) => measure(line) > contentWidth)) {
    titleSize -= 2;
    doc.setFontSize(titleSize);
  }
  text(model.cover.title[0], MARGIN, 110);
  text(model.cover.title[1], MARGIN, 125);

  stroke(PRIMARY);
  doc.setLineWidth(2);
  doc.line(MARGIN, 135, MARGIN + 60, 135);

  doc.setFontSize(12);
  setStyle('normal');
  let coverY = 150;
  model.cover.lines.forEach((line) => {
    wrap(line, contentWidth).forEach((part) => {
      text(part, MARGIN, coverY);
      coverY += 8;
    });
  });
  y = coverY;

  if (model.cover.isDemo) {
    const top = Math.max(y + 6, 196);
    setStyle('bold');
    doc.setFontSize(11);
    ink(ALERT);
    doc.text('DEMO — NOT LIVE DATA', MARGIN, top);
    setStyle('normal');
    doc.setFontSize(6.5);
    wrap(model.demoNotice ?? '', contentWidth).forEach((line, i) => text(line, MARGIN, top + 5 + i * 3.2));
  }

  // The note under the name is the longest sentence on this page and the column is half a box: it
  // is wrapped first, and the box is drawn to hold what it actually needed rather than the 40 pt
  // that fitted the two-word line the previous cover printed there.
  setStyle('normal');
  doc.setFontSize(7);
  const noteLines = model.cover.left.lines.slice(1).flatMap((line) => wrap(line, contentWidth / 2 - 14));
  const boxHeight = Math.max(40, 239 + noteLines.length * 3.2 + 5 - 210);
  paint(BOX_FILL);
  doc.rect(MARGIN, 210, contentWidth, boxHeight, 'F');
  setStyle('bold');
  ink(SECONDARY);
  const columnWidth = pageWidth / 2 - MARGIN - 22;
  let headingSize = 10;
  doc.setFontSize(headingSize);
  while (headingSize > 7 && measure(model.cover.left.heading) > columnWidth) {
    headingSize -= 0.5;
    doc.setFontSize(headingSize);
  }
  text(model.cover.left.heading, MARGIN + 10, 222);
  doc.setFontSize(10);
  text(model.cover.right.heading, pageWidth / 2, 222);
  setStyle('normal');
  doc.setFontSize(10);
  text(model.cover.left.lines[0] ?? '', MARGIN + 10, 232);
  // The note was wrapped at 7 pt, so it is drawn at 7 pt too; the name above it is the only 10 pt
  // line in this column, and the size has to be set back before the note starts.
  doc.setFontSize(7);
  noteLines.forEach((line, i) => text(line, MARGIN + 10, 239 + i * 3.2));
  doc.setFontSize(10);
  model.cover.right.lines.forEach((line, i) => text(line, pageWidth / 2, 232 + i * 6));

  doc.setFontSize(7);
  ink(MUTED);
  wrap('This file reproduces what the publishers answered. It is not signed, sealed or encrypted, and its reference is a lookup key rather than an authorisation.', contentWidth).forEach(
    (line, i) => text(line, MARGIN, 210 + boxHeight + 12 + i * 3.4),
  );

  /* ----------------------------------------------------------------- blocks ----------------------------------------------------------------- */

  newPage();
  for (const block of model.blocks) drawBlock(block);

  function drawBlock(block: PdfBlock): void {
    switch (block.type) {
      case 'page-break':
        newPage();
        break;

      case 'heading': {
        ensure(18);
        setStyle('bold');
        doc.setFontSize(14);
        ink(PRIMARY);
        text(block.text, MARGIN, y);
        y += 8;
        break;
      }

      case 'subheading': {
        ensure(12);
        setStyle('bold');
        doc.setFontSize(11);
        ink(SECONDARY);
        text(block.text, MARGIN, y);
        y += 6;
        break;
      }

      case 'paragraph': {
        setStyle('normal');
        doc.setFontSize(9);
        ink(SECONDARY);
        for (const line of wrap(block.text, contentWidth)) {
          ensure(6);
          text(line, MARGIN, y);
          y += 4.6;
        }
        y += 2;
        break;
      }

      case 'bullet': {
        setStyle('normal');
        doc.setFontSize(8);
        ink(MUTED);
        const lines = wrap(block.text, contentWidth - 8);
        ensure(lines.length * 4 + 3);
        doc.text('•', MARGIN, y);
        lines.forEach((line, i) => text(line, MARGIN + 4, y + i * 4));
        y += lines.length * 4 + 1.5;
        break;
      }

      case 'kv': {
        const font = tableFont(block.rows.map((row) => [...row]));
        autoTable(doc, {
          startY: y,
          body: block.rows.map(([label, value]) => [fitted(label), fitted(value)]),
          theme: 'plain',
          styles: { fontSize: 8, cellPadding: 2, textColor: SECONDARY, font: font ?? 'helvetica' },
          // The embedded file is one weight: a Ge'ez label keeps its column, not a bold it cannot have.
          columnStyles: { 0: { fontStyle: font ? 'normal' : 'bold', cellWidth: 48 } },
          margin: { left: MARGIN, right: MARGIN, top: firstContentRow, bottom: 34 },
          didDrawPage: frame,
        });
        y = finalY(doc) + 6;
        break;
      }

      case 'table':
        drawTable(block);
        break;

      case 'chart':
        drawChart(block);
        break;

      case 'chart-unavailable':
        drawNoDataChart(block);
        break;

      case 'box': {
        const body = block.lines.flatMap((line) => wrap(line, contentWidth - 14));
        const height = 12 + body.length * 4 + 4;
        ensure(height + 6);
        paint(BOX_FILL);
        doc.rect(MARGIN, y - 5, contentWidth, height, 'F');
        setStyle('bold');
        doc.setFontSize(11);
        ink(SECONDARY);
        text(block.title, MARGIN + 7, y);
        setStyle('normal');
        doc.setFontSize(8);
        body.forEach((line, i) => text(line, MARGIN + 7, y + 6 + i * 4));
        y += height + 3;
        break;
      }
    }
  }

  function drawTable(block: PdfTableBlock): void {
    const columnStyles: Record<number, { cellWidth?: number }> = {};
    if (block.columnWidths) block.columnWidths.forEach((w, i) => (columnStyles[i] = { cellWidth: w }));
    const font = tableFont([block.head, ...block.rows]);

    autoTable(doc, {
      startY: y,
      head: [block.head.map(fitted)],
      body: block.rows.map((row) => row.map(fitted)),
      theme: block.theme,
      headStyles: { fillColor: block.headerColor, fontSize: block.fontSize + 1, fontStyle: font ? 'normal' : 'bold', font: font ?? 'helvetica' },
      styles: { fontSize: block.fontSize, cellPadding: 1.6, overflow: 'linebreak', lineColor: GRID, font: font ?? 'helvetica' },
      ...(block.theme === 'striped' ? { alternateRowStyles: { fillColor: [245, 247, 250] } } : {}),
      columnStyles,
      margin: { left: MARGIN, right: MARGIN, top: firstContentRow, bottom: 34 },
      didDrawPage: frame,
    });
    y = finalY(doc) + 5;
  }

  /**
   * A chart is drawn from the series the contract holds, and only from those points. A null point is
   * a gap in the line, never a zero-height bar or a point on the axis.
   */
  function drawChart(block: PdfChartBlock): void {
    const values = block.series.flatMap((s) => s.points).map((p) => p.y).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) {
      drawNoDataChart({
        type: 'chart-unavailable',
        title: block.title,
        reason: 'No numeric value was published for this series, so there is nothing to plot.',
        caption: block.caption,
      });
      return;
    }

    ensure(CHART_HEIGHT + 30);
    setStyle('bold');
    doc.setFontSize(9);
    ink(SECONDARY);
    text(block.title, MARGIN, y);
    y += 5;

    const axisLeft = MARGIN + 16;
    const plotWidth = contentWidth - 18;
    const top = y;
    const bottom = y + CHART_HEIGHT;
    const max = Math.max(...values);
    const min = Math.min(0, ...values);
    const span = max - min === 0 ? Math.abs(max) || 1 : max - min;
    const at = (value: number) => bottom - ((value - min) / span) * CHART_HEIGHT;

    setStyle('normal');
    doc.setFontSize(6);
    for (let g = 0; g <= 4; g += 1) {
      const value = min + (span * g) / 4;
      const gy = at(value);
      stroke(GRID);
      doc.setLineWidth(0.1);
      doc.line(axisLeft, gy, axisLeft + plotWidth, gy);
      ink(MUTED);
      doc.text(axisLabel(value), axisLeft - 2, gy + 1, { align: 'right' });
    }

    stroke(AXIS);
    doc.setLineWidth(0.2);
    doc.line(axisLeft, bottom, axisLeft + plotWidth, bottom);
    doc.line(axisLeft, top, axisLeft, bottom);

    const asBars = block.series.length === 1 && block.series[0].points.length <= 10;
    block.series.forEach((series, s) => {
      const colour = SERIES_COLORS[s % SERIES_COLORS.length];
      if (asBars) {
        const slot = plotWidth / Math.max(1, series.points.length);
        series.points.forEach((point, i) => {
          if (point.y === null) return;
          const barWidth = slot * 0.62;
          const x = axisLeft + i * slot + (slot - barWidth) / 2;
          paint(colour);
          doc.rect(x, at(point.y), barWidth, bottom - at(point.y), 'F');
        });
        return;
      }
      stroke(colour);
      doc.setLineWidth(0.5);
      const steps = Math.max(1, series.points.length - 1);
      let penDown = false;
      let prevX = axisLeft;
      let prevY = bottom;
      series.points.forEach((point, i) => {
        if (point.y === null) {
          penDown = false;
          return;
        }
        const px = axisLeft + (series.points.length === 1 ? plotWidth / 2 : (plotWidth * i) / steps);
        const py = at(point.y);
        if (penDown) doc.line(prevX, prevY, px, py);
        prevX = px;
        prevY = py;
        penDown = true;
        if (series.points.length <= 24) {
          paint(colour);
          doc.circle(px, py, 0.7, 'F');
        }
      });
    });

    if (block.series.length > 1) {
      let legendX = axisLeft;
      doc.setFontSize(6.5);
      block.series.forEach((series, s) => {
        const width = measure(series.label) + 7;
        if (legendX + width > axisLeft + plotWidth) return;
        paint(SERIES_COLORS[s % SERIES_COLORS.length]);
        doc.rect(legendX, top - 4, 2.5, 2.5, 'F');
        ink(MUTED);
        text(series.label, legendX + 3.2, top - 2);
        legendX += width;
      });
    }

    const first = block.series[0];
    if (first && first.points.length > 0) {
      doc.setFontSize(5.5);
      ink(MUTED);
      const steps = Math.max(1, first.points.length - 1);
      const every = Math.max(1, Math.ceil(first.points.length / Math.max(1, Math.floor(plotWidth / 20))));
      for (let i = 0; i < first.points.length; i += every) {
        const point = first.points[i];
        if (!point) continue;
        const px = axisLeft + (first.points.length === 1 ? plotWidth / 2 : (plotWidth * i) / steps);
        text(point.x, px, bottom + 4, { align: 'center', maxWidth: 18 });
      }
    }

    y = bottom + 9;
    y = caption(block.caption, y);
    y += 2;
  }

  /** The same chart area, filled with the reason the contract gave instead of a series. */
  function drawNoDataChart(block: PdfNoChartDataBlock): void {
    ensure(CHART_HEIGHT + 26);
    setStyle('bold');
    doc.setFontSize(9);
    ink(SECONDARY);
    text(block.title, MARGIN, y);
    y += 5;

    const top = y;
    const bottom = y + CHART_HEIGHT;
    paint(BOX_FILL);
    doc.rect(MARGIN + 16, top, contentWidth - 18, CHART_HEIGHT, 'F');
    stroke(AXIS);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(MARGIN + 16, top, contentWidth - 18, CHART_HEIGHT, 'S');
    doc.setLineDashPattern([], 0);

    setStyle('bold');
    doc.setFontSize(8);
    ink(ALERT);
    doc.text('No chart drawn — the chart area is kept, the figure is not invented.', MARGIN + 22, top + 8);
    setStyle('normal');
    doc.setFontSize(8);
    ink(SECONDARY);
    wrap(block.reason, contentWidth - 32)
      .slice(0, Math.floor((CHART_HEIGHT - 14) / 4))
      .forEach((line, i) => text(line, MARGIN + 22, top + 15 + i * 4));

    y = bottom + 5;
    y = caption(block.caption, y);
    y += 2;
  }

  function caption(value: string, from: number): number {
    setStyle('normal');
    doc.setFontSize(7);
    ink(MUTED);
    const lines = wrap(value, contentWidth);
    lines.forEach((line, i) => text(line, MARGIN, from + i * 3.4));
    return from + lines.length * 3.4;
  }

  /* ---------------------------------------------------------------- finish ---------------------------------------------------------------- */

  /**
   * The one sentence this layer writes, and it is about its own typography rather than the data: a
   * character nothing on this page can hold is shown as `[?]` and named here by code point, so an
   * Amharic or Oromo label that the fonts could not carry is reported rather than quietly lost.
   */
  const lost = [...unrendered].filter((name) => name !== '');
  if (lost.length > 0) {
    newPage();
    setStyle('bold');
    doc.setFontSize(11);
    ink(ALERT);
    text('Characters this file could not render', MARGIN, y);
    y += 7;
    setStyle('normal');
    doc.setFontSize(8);
    ink(SECONDARY);
    const body = wrap(
      `${lost.length} character${lost.length === 1 ? '' : 's'} in this report are written in a script none of the fonts in this file can draw, so they appear as [?] where they occur: ${lost.join(', ')}. No figure, unit or date is affected. The report on screen shows the exact text.`,
      contentWidth,
    );
    body.forEach((line, i) => text(line, MARGIN, y + i * 4));
  }

  const total = pages(doc);
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    if (page > 1) frame();
    if (model.demoNotice && page > 1) {
      paint([254, 242, 242]);
      doc.rect(11, 11, pageWidth - 22, 17, 'F');
      setStyle('bold');
      doc.setFontSize(8);
      ink(ALERT);
      doc.text('DEMO — NOT LIVE DATA', 15, 17);
      setStyle('normal');
      doc.setFontSize(6);
      ink(SECONDARY);
      wrap(model.demoNotice, pageWidth - 30).forEach((line, i) => text(line, 15, 21 + i * 2.8));
    }
    doc.setFontSize(7);
    ink(FOOTER_GREY);
    doc.text(`Page ${page} of ${total}`, pageWidth - MARGIN, pageHeight - 15, { align: 'right' });
    text(model.footer, MARGIN, pageHeight - 15);
  }

  return { blob: new Blob([doc.output('blob')], { type: 'application/pdf' }), filename: model.filename, unrendered: [...unrendered] };
};

/* ------------------------------------------------------------------ utilities ------------------------------------------------------------------ */

/**
 * jsPDF's standard fonts are WinAnsi-encoded, and a single character outside that table re-encodes
 * the whole string: a publisher formula containing `Σ` comes back as interleaved NUL bytes.
 *
 * Three tiers, in order: a glyph the base font holds is drawn as written; a symbol it lacks but that
 * has a documented word reading is spelled out, because the word is the publisher's meaning and the
 * glyph is only a shape; a character outside WinAnsi is drawn with the embedded Unicode font when
 * that font holds it. Only when nothing holds it does anything change, and then it becomes a visible
 * marker and its code point is collected so the file can say what it could not render. The base font
 * never silently deletes a character.
 */
const WINANSI_SAFE = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™šœžŸ]*$/;

const isWinAnsi = (value: string): boolean => WINANSI_SAFE.test(value);

const GLYPH_FALLBACK: Record<string, string> = {
  'Σ': ' sum of ',
  '∑': ' sum of ',
  '→': ' -> ',
  '←': ' <- ',
  '↑': ' up ',
  '↓': ' down ',
  'Δ': ' delta ',
  '≥': ' >= ',
  '≤': ' <= ',
  '≠': ' != ',
  '≈': ' ~ ',
  '√': ' sqrt ',
  '∞': ' infinity ',
  '✓': ' yes ',
  '✗': ' no ',
  '\uFE0F': '',
  '\t': '  ',
};

/** The code point of a character, as it is disclosed to the reader when nothing can draw it. */
const codePointName = (char: string): string => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

const fontHolds = (font: PdfUnicodeFont | null, char: string): boolean => {
  if (font === null) return false;
  const point = char.codePointAt(0) ?? 0;
  return font.extraRanges.some(([first, last]) => point >= first && point <= last);
};

/** jsPDF parses the TTF on registration and subsets it to the glyphs actually used. */
const registerFont = (doc: jsPDF, font: PdfUnicodeFont): string | null => {
  try {
    doc.addFileToVFS(font.fileName, font.base64);
    doc.addFont(font.fileName, font.postScriptName, 'normal');
    return font.postScriptName;
  } catch {
    // A font that will not register is a typography failure, not a data failure: the text falls
    // back to the disclosed-marker path instead of losing the figure it carries.
    return null;
  }
};

/** Every string a document would print, so a caller can ask whether it needs the Unicode font. */
const documentStrings = (model: PdfDocument): string[] => [
  model.filename,
  model.demoNotice ?? '',
  model.footer,
  ...model.cover.title,
  model.cover.left.heading,
  model.cover.right.heading,
  ...model.cover.lines,
  ...model.cover.left.lines,
  ...model.cover.right.lines,
  ...model.blocks.flatMap((block) => {
    if (block.type === 'table') return [block.head, ...block.rows].flat();
    if (block.type === 'kv') return block.rows.flat();
    if (block.type === 'box') return [block.title, ...block.lines];
    if (block.type === 'chart') return [block.title, block.caption, ...block.series.map((s) => s.label), ...block.series.flatMap((s) => s.points.map((p) => p.x))];
    if (block.type === 'chart-unavailable') return [block.title, block.reason, block.caption];
    if (block.type === 'page-break') return [];
    return [block.text];
  }),
];

/**
 * The base-font path, exported for callers outside the renderer: a character nothing can hold becomes
 * a visible marker rather than nothing at all.
 */
export function pdfSafe(value: string): string {
  const cleaned = value.replace(/\r?\n/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
  if (isWinAnsi(cleaned)) return cleaned;
  let out = '';
  for (const char of cleaned) {
    if (isWinAnsi(char)) out += char;
    else if (char in GLYPH_FALLBACK) out += GLYPH_FALLBACK[char];
    else out += '[?]';
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

const finalY = (doc: jsPDF): number => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

const pages = (doc: jsPDF): number => (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();

const axisLabel = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  if (Number.isInteger(value)) return String(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 1 ? value.toFixed(1) : value.toFixed(2);
};

/** The cover logo, through the same canvas route the previous export used; failing it means the text mark. */
const loadLogo = async (): Promise<string | null> => {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.setAttribute('crossOrigin', 'anonymous');
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg'));
    };
    img.onerror = () => resolve(null);
    img.src = '/Logo.png';
  });
};
