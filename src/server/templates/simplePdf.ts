import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function toWinAnsiSafeText(input: string): string {
  return Array.from(input)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0x0a || code === 0x0d || code === 0x09) return ' ';
      if (code >= 0x20 && code <= 0x7e) return ch;
      return '?';
    })
    .join('');
}

async function tryLoadJapaneseFont(pdf: PDFDocument): Promise<PDFFont | null> {
  try {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf');
    const bytes = await readFile(fontPath);
    pdf.registerFontkit(fontkit);
    return await pdf.embedFont(bytes, { subset: true });
  } catch {
    return null;
  }
}

export async function generateSimplePdf(args: {
  kind: 'invoice' | 'report';
  title: string;
  subtitle: string;
  lines: string[];
}): Promise<{ bytes: Uint8Array; filename: string; contentType: string }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const jpFont = await tryLoadJapaneseFont(pdf);
  const fallbackFont = await pdf.embedFont(StandardFonts.Helvetica);
  const font = jpFont ?? fallbackFont;

  const drawTitle = jpFont ? args.title : toWinAnsiSafeText(args.title);
  const drawSubtitle = jpFont ? args.subtitle : toWinAnsiSafeText(args.subtitle);
  const drawLines = jpFont ? args.lines : args.lines.map((l) => toWinAnsiSafeText(l));

  const margin = 48;
  let y = 841.89 - margin;

  page.drawText(drawTitle, { x: margin, y, size: 22, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 28;
  page.drawText(drawSubtitle, { x: margin, y, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 22;

  const stamp = new Date().toISOString();
  page.drawText(`generatedAt: ${stamp}`, {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
  y -= 18;

  if (drawLines.length > 0) {
    page.drawText(jpFont ? '内容:' : 'Content:', { x: margin, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    y -= 14;
    for (const line of drawLines.slice(0, 60)) {
      if (y < margin + 24) break;
      page.drawText(`- ${line}`, { x: margin, y, size: 10.5, font, color: rgb(0.15, 0.15, 0.15) });
      y -= 13;
    }
  }

  const bytes = await pdf.save();
  const filename = `${args.kind}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { bytes, filename, contentType: 'application/pdf' };
}
