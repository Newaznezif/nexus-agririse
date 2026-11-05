"""Rasterise generated evidence PDFs for visual inspection.

Phase 5 checks that a PDF looks right as well as that it says the right thing, and the text-mode
checks cannot see clipping, a note overflowing its box, or a chart placeholder drawn over a table.
This writes the requested pages as PNGs under artifacts/pdf/pages/ plus a UTF-8 page map (Windows
console code pages cannot print Ethiopic, so the text goes to a file).

Run from the repository root, after `node scripts/check-pdf-render.mjs` has written the PDFs:

    python scripts/render-pdf-pages.py                    # every document listed below
    python scripts/render-pdf-pages.py complete.pdf       # one of them
"""

import glob
import io
import os
import sys

import pypdfium2 as pdfium

OUT = os.path.join('artifacts', 'pdf')
PAGES = os.path.join(OUT, 'pages')

# Cover, a table page, a chart page and the last page of each document are where geometry fails.
WANT = {
    'complete.pdf': [1, 4, 6, 9],
    'unavailable-chart.pdf': [4],
    'demo.pdf': [1, 6],
    'unicode-with-embedded-face.pdf': [1, 6, 7, 11],
    'unicode-no-font.pdf': [1, 11],
    'no-data.pdf': [1, 2],
    'partial.pdf': [5],
    'analysis-record.pdf': [1, 4],
    # Written by scripts/check-pdf-live.mjs when the publishers answer; its name carries the run date.
    'live_bundle_*.pdf': [1, 5, 6, 10],
}


def inspect(report, path, pages):
    name = os.path.basename(path)
    doc = pdfium.PdfDocument(path)
    size = doc[0].get_size()
    report.write('== %s  %d pages  %.1f x %.1f pt\n' % (name, len(doc), size[0], size[1]))
    for i, page in enumerate(doc):
        text = ' '.join(page.get_textpage().get_text_bounded().split())
        report.write('  p%-2d %s\n' % (i + 1, text[:200]))
    for n in pages:
        if n > len(doc):
            report.write('  p%d does not exist in this run\n' % n)
            continue
        img = doc[n - 1].render(scale=2.0).to_pil()
        out = os.path.join(PAGES, '%s-p%d.png' % (name.replace('.pdf', ''), n))
        img.save(out)
        report.write('  wrote %s (%d x %d px)\n' % (os.path.basename(out), img.size[0], img.size[1]))
    doc.close()


def main(argv):
    os.makedirs(PAGES, exist_ok=True)
    report = io.open(os.path.join(PAGES, 'page-map.txt'), 'w', encoding='utf-8')
    for name in argv or sorted(WANT):
        # A pattern key resolves to whatever the last run left on disk.
        paths = sorted(glob.glob(os.path.join(OUT, name))) if any(c in name for c in '*?[') else [os.path.join(OUT, name)]
        if not paths or not os.path.exists(paths[0]):
            report.write('== %s  MISSING\n' % name)
            continue
        for path in paths:
            inspect(report, path, WANT.get(name, [1]))
    report.close()
    print('wrote page map and PNGs to %s' % PAGES)


if __name__ == '__main__':
    main(sys.argv[1:])
