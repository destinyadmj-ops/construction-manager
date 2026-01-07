const { app, BrowserWindow, Menu, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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

const DEFAULT_URL = normalizeBaseUrl(process.env.MASTER_HUB_URL);
const DEFAULT_ORIGIN = (() => {
  try {
    return new URL(DEFAULT_URL).origin;
  } catch {
    return 'http://127.0.0.1:3000';
  }
})();

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

async function showAbout(win) {
  const webVersion = await fetchJson(`${DEFAULT_ORIGIN}/api/version`);
  const info = webVersion && webVersion.ok && webVersion.info ? webVersion.info : null;

  const lines = [
    `URL: ${DEFAULT_URL}`,
    `Electron: ${process.versions.electron}`,
    `Chrome: ${process.versions.chrome}`,
    `Node: ${process.versions.node}`,
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
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => win.webContents.reload() },
        {
          label: 'キャッシュ無視で再読み込み',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win.webContents.reloadIgnoringCache(),
        },
        { type: 'separator' },
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
        { type: 'separator' },
        {
          label: 'バージョン情報',
          click: () => void showAbout(win),
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
}

app.whenReady().then(() => {
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
