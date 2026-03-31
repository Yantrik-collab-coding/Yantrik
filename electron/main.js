/**
 * electron/main.js
 * Yantrik Desktop — Main Process
 *
 * Responsibilities:
 *  1. Spawn the FastAPI backend as a child process
 *  2. Wait for it to be healthy (poll /api/health)
 *  3. Load the React frontend in a BrowserWindow
 *  4. Handle IPC for PTY (terminal) sessions
 *  5. Clean up backend on app quit
 */

'use strict'

const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron')
const path   = require('path')
const { spawn, execFile } = require('child_process')
const http   = require('http')
const fs     = require('fs')
const pty    = require('node-pty')

// File sync — registers IPC handlers for local filesystem mirroring
const fileSync = require('./file-sync')

// ── Config ────────────────────────────────────────────────────────────────────

const BACKEND_PORT = 8000
const BACKEND_URL  = `http://localhost:${BACKEND_PORT}`
const IS_DEV       = process.env.NODE_ENV === 'development' || !app.isPackaged
const FRONTEND_URL = IS_DEV
  ? 'http://localhost:3000'          // Vite dev server
  : `${BACKEND_URL}`                 // FastAPI serves built dist

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow   = null
let backendProc  = null
let ptyProcesses = {}   // projectId → node-pty instance

// ── Backend resolution ────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the Python executable and the backend directory.
 * In dev: uses system python3 in the repo's backend/ folder.
 * In prod: uses the bundled Python inside resources/, or falls back to system Python.
 */
function resolveBackend() {
  if (IS_DEV) {
    const repoRoot   = path.resolve(__dirname, '..')
    const backendDir = path.join(repoRoot, 'backend')
    const python     = process.platform === 'win32' ? 'python' : 'python3'
    return { python, backendDir }
  }

  // Packaged: resources/backend/ and resources/python/
  const resources  = process.resourcesPath
  const backendDir = path.join(resources, 'backend')
  const bundledPython = process.platform === 'win32'
    ? path.join(resources, 'python', 'python.exe')
    : path.join(resources, 'python', 'bin', 'python3')

  // Use bundled Python if available, otherwise fall back to system Python
  const python = fs.existsSync(bundledPython) ? bundledPython : (process.platform === 'win32' ? 'python' : 'python3')
  return { python, backendDir }
}

// ── Backend lifecycle ─────────────────────────────────────────────────────────

function startBackend() {
  const { python, backendDir } = resolveBackend()

  console.log(`[backend] Starting with ${python} in ${backendDir}`)

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    // In packaged mode, point to the correct .env or use defaults
    PORT: String(BACKEND_PORT),
  }

  backendProc = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], {
    cwd: backendDir,
    env,
    // Windows needs shell: true for python to resolve
    shell: process.platform === 'win32',
  })

  backendProc.stdout.on('data', d => process.stdout.write(`[backend] ${d}`))
  backendProc.stderr.on('data', d => process.stderr.write(`[backend] ${d}`))

  backendProc.on('exit', (code, signal) => {
    console.log(`[backend] Exited — code=${code} signal=${signal}`)
    backendProc = null
    // If the window is still open, tell it the backend crashed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:crashed', { code, signal })
    }
  })
}

function stopBackend() {
  if (!backendProc) return
  console.log('[backend] Stopping...')
  backendProc.kill('SIGTERM')
  backendProc = null
}

// ── Health polling ────────────────────────────────────────────────────────────

function waitForBackend(maxAttempts = 30, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    let attempts = 0

    const check = () => {
      attempts++
      const req = http.get(`${BACKEND_URL}/api/health`, res => {
        if (res.statusCode === 200) {
          console.log(`[backend] Healthy after ${attempts} attempts`)
          resolve()
        } else {
          retry()
        }
      })
      req.on('error', retry)
      req.setTimeout(800, () => { req.destroy(); retry() })
    }

    const retry = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`Backend did not start after ${maxAttempts} attempts`))
        return
      }
      setTimeout(check, intervalMs)
    }

    check()
  })
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d1117',
    show: false,   // shown after backend is ready
    icon: path.join(__dirname, '..', 'public', 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true,  // Enable DevTools for debugging (disable in production)
    },
  })

  // Pass main window reference to file-sync for sending watcher events
  fileSync.setMainWindow(mainWindow)

  // Setup debug logging
  setupDevToolsLogging()

  // Set security headers (CSP disabled for packaged app - backend serves content)
  // Note: CSP is handled by the backend in production
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
        'Referrer-Policy': ['strict-origin-when-cross-origin']
      }
    })
  })

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Open DevTools with F12 for debugging
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && !input.control && !input.meta && !input.shift && !input.alt) {
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    fileSync.setMainWindow(null)
  })
}

async function loadApp() {
  try {
    console.log(`[main] Loading app from ${FRONTEND_URL}`)
    await mainWindow.loadURL(FRONTEND_URL)
    console.log('[main] App loaded successfully')
  } catch (err) {
    console.error('[main] Failed to load app:', err)
    dialog.showErrorBox('Failed to Load', `Could not load the application:\n\n${err.message}`)
  }
}

// Debug: Log console messages from the renderer
function setupDevToolsLogging() {
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['debug', 'info', 'warn', 'error']
    console.log(`[renderer:${levels[level] || 'log'}] ${message}`)
  })

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[main] Failed to load:', errorCode, errorDescription)
  })
}

// ── PTY / Terminal IPC ────────────────────────────────────────────────────────

/**
 * Each project gets one persistent PTY.
 * The renderer requests a session via ipcMain, sends input, and receives output.
 */

ipcMain.handle('pty:create', (event, { projectId, cwd }) => {
  if (ptyProcesses[projectId]) {
    // Already exists — just re-attach (renderer reconnected)
    return { ok: true, existed: true }
  }

  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
  const workDir = cwd || app.getPath('home')

  try {
    const ptyProc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workDir,
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    ptyProcesses[projectId] = ptyProc

    ptyProc.onData(data => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`pty:data:${projectId}`, data)
      }
    })

    ptyProc.onExit(({ exitCode }) => {
      console.log(`[pty] Project ${projectId} shell exited with code ${exitCode}`)
      delete ptyProcesses[projectId]
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`pty:exit:${projectId}`, { exitCode })
      }
    })

    return { ok: true, existed: false }
  } catch (err) {
    console.error('[pty] Failed to spawn:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.on('pty:write', (event, { projectId, data }) => {
  const proc = ptyProcesses[projectId]
  if (proc) proc.write(data)
})

ipcMain.on('pty:resize', (event, { projectId, cols, rows }) => {
  const proc = ptyProcesses[projectId]
  if (proc) proc.resize(cols, rows)
})

ipcMain.on('pty:kill', (event, { projectId }) => {
  const proc = ptyProcesses[projectId]
  if (proc) {
    proc.kill()
    delete ptyProcesses[projectId]
  }
})

// ── App events ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow()

  // Show a splash/loading state in the window while backend starts
  mainWindow.loadFile(path.join(__dirname, 'loading.html'))
  mainWindow.show()

  try {
    startBackend()
    await waitForBackend(40, 750)
    await loadApp()
  } catch (err) {
    console.error('[main] Backend failed to start:', err)
    dialog.showErrorBox('Yantrik failed to start', `The backend server did not start:\n\n${err.message}\n\nCheck the console for details.`)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // Kill all PTYs
  for (const [id, proc] of Object.entries(ptyProcesses)) {
    try { proc.kill() } catch {}
  }
  ptyProcesses = {}

  stopBackend()

  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  stopBackend()
})