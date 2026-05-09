# Yantrik Desktop — Electron Integration Guide

## What this adds

| File | Purpose |
|------|---------|
| `electron/main.js` | Main process: spawns FastAPI, manages window, hosts PTY |
| `electron/preload.js` | Context bridge: exposes `window.electronAPI` to React |
| `electron/loading.html` | Splash screen shown while backend boots |
| `electron/entitlements.mac.plist` | macOS hardened runtime permissions |
| `electron-builder.json` | Cross-platform packaging config |
| `package.json` (root) | Electron + build scripts (sits above `frontend/` and `backend/`) |
| `frontend/src/components/Terminal.tsx` | Drop-in terminal: real PTY in Desktop, run-output fallback in browser |

Zero changes to the FastAPI backend. Not a single line.

---

## Directory layout after integration

```
yantrik/
├── electron/
│   ├── main.js
│   ├── preload.js
│   ├── loading.html
│   └── entitlements.mac.plist
├── frontend/           (unchanged — your existing React app)
│   ├── src/
│   │   └── components/
│   │       └── Terminal.tsx   ← replace / add this
│   └── ...
├── backend/            (unchanged — your existing FastAPI app)
├── electron-builder.json
└── package.json        ← NEW root package.json
```

---

## Step 1 — Install root dependencies

```bash
# In the repo root (NOT inside frontend/)
npm install

# This installs:
#   electron, electron-builder, concurrently, wait-on (devDeps)
#   node-pty (runtime dep for PTY)
```

> **Windows note**: `node-pty` needs the Visual Studio Build Tools and Python 2.7 for native compilation.
> Run `npm install --global windows-build-tools` first, or install VS Build Tools manually.

---

## Step 2 — Install xterm.js in the frontend

```bash
cd frontend
npm install xterm @xterm/addon-fit
```

Add the xterm CSS import to `frontend/src/main.tsx` (or `index.css`):

```ts
// frontend/src/main.tsx  — add at the top
import 'xterm/css/xterm.css'
```

---

## Step 3 — Swap the Terminal in ProjectPage.tsx

Find the existing terminal block in `ProjectPage.tsx` (around line 490, the `{showTerminal && (` block) and replace it:

**Before:**
```tsx
{showTerminal && (
  <div style={{ height: 220, background: '#0d1117', ... }}>
    {/* ...fake run output panel... */}
  </div>
)}
```

**After:**
```tsx
import Terminal from '../components/Terminal'

// ...inside the JSX, replacing the old block:
{showTerminal && (
  <Terminal
    projectId={id!}
    show={showTerminal}
    onClose={() => setShowTerminal(false)}
    runOutput={runOutput}
    running={running}
    activeFilename={activeFile?.filename}
  />
)}
```

The `Terminal` component auto-detects whether it's running in Electron.
In the browser, it shows the existing run-output panel unchanged.
In Electron, it mounts a real xterm.js instance connected to a live PTY.

---

## Step 4 — Dev workflow

```bash
# Terminal 1 (repo root): start Electron + Vite concurrently
npm run dev
```

This runs `concurrently`:
- `cd frontend && npm run start`  → Vite dev server on :3000
- `wait-on http://localhost:3000 && electron .`  → launches Electron after Vite is ready

Electron main process spawns `uvicorn` automatically on :8000.

---

## Step 5 — Production build

```bash
# In repo root:
npm run build

# This runs:
#   1. cd frontend && npm run build   (outputs frontend/dist/)
#   2. electron-builder               (packages everything into dist-electron/)
```

Output by platform:

| Platform | Output |
|----------|--------|
| Windows  | `dist-electron/Yantrik Setup 1.0.0.exe` (NSIS installer) |
| macOS    | `dist-electron/Yantrik-1.0.0.dmg` |
| Linux    | `dist-electron/Yantrik-1.0.0.AppImage` |

---

## How the backend is distributed

In the packaged app, `backend/` is copied into `resources/backend/` via `extraResources`.

The user must have Python 3.12+ installed (or you bundle it — see Advanced below).

On first launch, users may need to install dependencies:

```bash
pip install -r resources/backend/requirements.txt
```

**Recommended**: add a `SetupPage.tsx` (Phase 1 next step) that checks for Python and pip-installs requirements automatically on first run.

---

## Advanced: Bundling Python

To ship a self-contained app (no Python required):

1. Use **PyInstaller** to freeze the FastAPI backend into a single executable:
   ```bash
   cd backend
   pip install pyinstaller
   pyinstaller --onefile --name yantrik-server main.py
   ```
2. In `electron/main.js`, change `startBackend()` to spawn `yantrik-server` instead of `python -m uvicorn`.
3. Add the compiled binary to `extraResources` in `electron-builder.json`.

This is Phase 3 work — get Phase 1 (Electron wrapper) working first.

---

## IPC API reference

Available on `window.electronAPI` in the renderer:

```ts
// Create/attach a terminal session for a project
await window.electronAPI.ptyCreate(projectId: string, cwd?: string)
  // → { ok: boolean, existed: boolean, error?: string }

// Send keystrokes to the shell
window.electronAPI.ptyWrite(projectId: string, data: string)

// Notify resize
window.electronAPI.ptyResize(projectId: string, cols: number, rows: number)

// Kill the shell
window.electronAPI.ptyKill(projectId: string)

// Subscribe to shell output — returns cleanup fn
const off = window.electronAPI.onPtyData(projectId, (data: string) => { ... })
off()  // unsubscribe

// Subscribe to shell exit
const off = window.electronAPI.onPtyExit(projectId, ({ exitCode }) => { ... })

// Subscribe to backend crash
const off = window.electronAPI.onBackendCrash(({ code, signal }) => { ... })

// Environment
window.electronAPI.isDesktop  // true
window.electronAPI.platform   // 'win32' | 'darwin' | 'linux'
```

---

## Troubleshooting

**`node-pty` build errors on Windows**
Run `npm install --global windows-build-tools` with admin privileges, then `npm install` again.

**Backend doesn't start**
Check the Electron DevTools console (View → Toggle Developer Tools). The backend stdout/stderr is printed there prefixed with `[backend]`.

**Blank white screen after loading**
The frontend built to `frontend/dist/` but the path in `main.js` doesn't match. Check `DIST_DIR` in `backend/main.py` and `FRONTEND_URL` in `electron/main.js`.

**xterm.js not rendering**
Make sure `import 'xterm/css/xterm.css'` is in `main.tsx`. Without the CSS, the terminal is invisible.
