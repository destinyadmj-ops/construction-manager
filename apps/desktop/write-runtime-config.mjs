import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.resolve(__dirname, 'build');
const outPath = path.join(outDir, 'runtime-config.json');

function normalizeHttpUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeBaseUrl(raw) {
  const normalized = normalizeHttpUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

function readExistingConfig() {
  try {
    if (!fs.existsSync(outPath)) return {};
    const raw = fs.readFileSync(outPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const existing = readExistingConfig();
const masterHubUrl = normalizeBaseUrl(process.env.MASTER_HUB_URL || existing.masterHubUrl);
const desktopReleaseUrl = normalizeHttpUrl(process.env.MASTER_HUB_UPDATE_URL || existing.desktopReleaseUrl);

if (!masterHubUrl) {
  console.error('[desktop] MASTER_HUB_URL is not set.');
  console.error('[desktop] Use scripts/package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/"');
  console.error('[desktop] or set MASTER_HUB_URL before running npm run dist / npm run pack.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const payload = {
  masterHubUrl,
  ...(desktopReleaseUrl ? { desktopReleaseUrl } : {}),
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`[desktop] wrote ${path.relative(process.cwd(), outPath)}`);
