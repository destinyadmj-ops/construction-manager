const { app, BrowserWindow, Menu, dialog, shell, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function normalizeHttpUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeBaseUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return 'http://127.0.0.1:3000/';
  try {
    const u = new URL(s);
    // Ensure trailing slash so relative nav behaves.
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    u.hash = '';
    return u.toString();
  } catch {
    return 'http://127.0.0.1:3000/';
  }
}

function readRuntimeConfig() {
  const p = path.join(__dirname, 'build', 'runtime-config.json');
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function parseVersion(raw) {
  return String(raw || '0.0.0')
    .split(/[.+-]/)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

const RUNTIME_CONFIG = readRuntimeConfig();
const DEFAULT_URL = normalizeBaseUrl(process.env.MASTER_HUB_URL || RUNTIME_CONFIG.masterHubUrl);
const DEFAULT_ORIGIN = (() => {
  try {
    return new URL(DEFAULT_URL).origin;
  } catch {
    return 'http://127.0.0.1:3000';
  }
})();
const DEFAULT_RELEASE_URL =
  normalizeHttpUrl(process.env.MASTER_HUB_UPDATE_URL || RUNTIME_CONFIG.desktopReleaseUrl) ||
  `${DEFAULT_ORIGIN}/api/desktop-release`;

async function fetchJson(url) {
  if (typeof fetch !== 'function') return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function checkForUpdates(win, { silentIfCurrent = false } = {}) {
  const releaseJson = await fetchJson(DEFAULT_RELEASE_URL);
  const release =
    releaseJson &&
    releaseJson.ok &&
    releaseJson.release &&
    typeof releaseJson.release === 'object' &&
    !Array.isArray(releaseJson.release)
      ? releaseJson.release
      : null;

  if (!release || typeof release.version !== 'string') {
    if (silentIfCurrent) return;
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: '更新確認',
      message: '更新情報を取得できませんでした。',
      detail: `更新確認URL: ${DEFAULT_RELEASE_URL}`,
    });
    return;
  }

  const currentVersion = app.getVersion();
  if (compareVersions(release.version, currentVersion) <= 0) {
    if (silentIfCurrent) return;
    await dialog.showMessageBox(win, {
      type: 'info',
      title: '更新確認',
      message: 'このデスクトップ版は最新です。',
      detail: `現在のバージョン: ${currentVersion}`,
    });
    return;
  }

  const downloadUrl = typeof release.downloadUrl === 'string' ? release.downloadUrl.trim() : '';
  const detail = [
    `現在: v${currentVersion}`,
    `最新: v${release.version}`,
    downloadUrl ? `配布URL: ${downloadUrl}` : '配布URL: 未設定',
    typeof release.notes === 'string' && release.notes.trim() ? `メモ: ${release.notes.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const hasDownload = downloadUrl.length > 0;
  const buttons = hasDownload ? ['ダウンロード', '閉じる'] : ['閉じる'];
  const result = await dialog.showMessageBox(win, {
    type: 'info',
    title: '更新があります',
    message: '新しいデスクトップ版が利用できます。',
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  if (hasDownload && result.response === 0) {
    void shell.openExternal(downloadUrl);
  }
}

async function showAbout(win) {
  const webVersion = await fetchJson(`${DEFAULT_ORIGIN}/api/version`);
  const info = webVersion && webVersion.ok && webVersion.info ? webVersion.info : null;

  const lines = [
    `URL: ${DEFAULT_URL}`,
    `Desktop: v${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Chrome: ${process.versions.chrome}`,
    `Node: ${process.versions.node}`,
    `Release info: ${DEFAULT_RELEASE_URL}`,
  ];
  if (info && typeof info === 'object') {
    if (typeof info.name === 'string' && typeof info.version === 'string') {
      lines.push(`Web: ${info.name} v${info.version}`);
    }
    if (typeof info.gitSha === 'string' && info.gitSha) lines.push(`git: ${info.gitSha}`);
    if (typeof info.buildTime === 'string' && info.buildTime) lines.push(`build: ${info.buildTime}`);
  }

  await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Master Hub Desktop',
    message: 'Master Hub Desktop（最小）',
    detail: lines.join('\n'),
  });
}

function createAppMenu(win) {
  const template = [
    {
      label: '表示',
      submenu: [
        { role: 'togglefullscreen', label: '全画面' },
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: '接続先URLをコピー',
          click: () => clipboard.writeText(DEFAULT_URL),
        },
        {
          label: 'ブラウザで開く',
          click: () => shell.openExternal(DEFAULT_URL),
        },
        {
          label: '更新を確認',
          click: () => void checkForUpdates(win),
        },
        { type: 'separator' },
        {
          label: 'バージョン情報',
          click: () => void showAbout(win),
        },
      ],
    },
    {
      label: 'リロード',
      submenu: [
        { label: '再読み込み', accelerator: 'F5', click: () => win.webContents.reload() },
        {
          label: 'キャッシュ無視で再読み込み',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win.webContents.reloadIgnoringCache(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const iconCandidates = [
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ];
  const windowIconPath = iconCandidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    ...(windowIconPath ? { icon: windowIconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setTitle('Master Hub');
  win.loadURL(DEFAULT_URL);
  createAppMenu(win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the default browser.
    try {
      const u = new URL(url);
      if (u.origin !== DEFAULT_ORIGIN) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    } catch {
      shell.openExternal(url);
      return { action: 'deny' };
    }
  });

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void checkForUpdates(win, { silentIfCurrent: true });
    }, 1500);
  });

  return win;
}

app.whenReady().then(() => {
  // 常にライトモードを強制
  try {
    nativeTheme.themeSource = 'light';
  } catch {}
  // Windows: taskbar grouping / notifications
  try {
    app.setAppUserModelId('jp.masterhub.desktop');
  } catch {
    // ignore
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
