import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcSvgPath = path.resolve(__dirname, '..', '..', 'public', 'icon.svg');
const outDir = path.resolve(__dirname, 'build');
const outPngPath = path.join(outDir, 'icon.png');
const outIcoPath = path.join(outDir, 'icon.ico');

if (!fs.existsSync(srcSvgPath)) {
  console.error(`[desktop] icon source not found: ${srcSvgPath}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const svg = fs.readFileSync(srcSvgPath, 'utf8');

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 256 },
});

const png = resvg.render().asPng();
fs.writeFileSync(outPngPath, png);

const ico = await pngToIco(png);
fs.writeFileSync(outIcoPath, ico);

console.log(`[desktop] wrote ${path.relative(process.cwd(), outPngPath)}`);
console.log(`[desktop] wrote ${path.relative(process.cwd(), outIcoPath)}`);
