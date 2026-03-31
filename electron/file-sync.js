/**
 * electron/file-sync.js
 * Yantrik Desktop — Bidirectional File Sync with File Watcher
 *
 * Syncs files between local filesystem (~/Yantrik/{projectName}/) and backend database.
 * Watches for external file changes (from terminal/git) and pushes them to backend.
 *
 * IPC surface:
 *   file-sync:write      { projectName, filename, content }      → { ok, path }
 *   file-sync:delete     { projectName, filename }               → { ok }
 *   file-sync:get-path    { projectName }                         → { path }
 *   file-sync:ensure      { projectName }                         → { path }
 *   file-sync:start-watch { projectName, projectId }              → { ok } - starts watcher
 *   file-sync:stop-watch   { projectName }                         → { ok } - stops watcher
 *   file-sync:sync-to-db  { projectName, filename, content }      → { ok } - manual sync
 *
 * Events to renderer:
 *   file-sync:changed    { projectName, filename, content }      - file changed externally
 *   file-sync:created    { projectName, filename, content }      - file created externally
 *   file-sync:deleted    { projectName, filename }              - file deleted externally
 */

'use strict'

const { app, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const chokidar = require('chokidar')

// Active file watchers: projectName -> watcher instance
const watchers = new Map()

// Debounce timers for batching rapid changes
const debounceTimers = new Map()
const DEBOUNCE_MS = 300

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitiseName(name) {
  return name
    .replace(/[<>:"\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    || 'project'
}

function getProjectDir(projectName) {
  const yantrikRoot = path.join(app.getPath('home'), 'Yantrik')
  return path.join(yantrikRoot, sanitiseName(projectName))
}

function ensureProjectDir(projectName) {
  const dir = getProjectDir(projectName)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function resolveFilePath(projectDir, filename) {
  const resolved = path.resolve(projectDir, filename)
  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
    throw new Error(`Path traversal rejected: ${filename}`)
  }
  return resolved
}

function getRelativePath(projectDir, absolutePath) {
  return path.relative(projectDir, absolutePath)
}

function debounce(key, fn) {
  if (debounceTimers.has(key)) {
    clearTimeout(debounceTimers.get(key))
  }
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key)
    fn()
  }, DEBOUNCE_MS))
}

// ── File Watcher ──────────────────────────────────────────────────────────────

function startFileWatcher(projectName, projectId, browserWindow) {
  const projectDir = getProjectDir(projectName)

  // Stop existing watcher if any
  stopFileWatcher(projectName)

  // Ensure directory exists
  fs.mkdirSync(projectDir, { recursive: true })

  const watcher = chokidar.watch(projectDir, {
    ignored: [
      /(^|[\/\\])\.git([\/\\]|$)/,           // .git folder
      /(^|[\/\\])node_modules([\/\\]|$)/,   // node_modules
      /(^|[\/\\])\.([\/\\]|$)/,             // hidden files
      '**/*.tmp',
      '**/*.log',
    ],
    persistent: true,
    ignoreInitial: true, // Don't fire events for existing files on startup
    depth: 10,
  })

  watcher.on('add', (filePath) => {
    const relativePath = getRelativePath(projectDir, filePath)
    if (relativePath.startsWith('..')) return // Outside project dir

    const key = `${projectName}:add:${relativePath}`
    debounce(key, () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        if (browserWindow && !browserWindow.isDestroyed()) {
          browserWindow.webContents.send('file-sync:created', {
            projectName,
            projectId,
            filename: relativePath,
            content,
          })
          console.log(`[file-sync] Detected new file: ${relativePath}`)
        }
      } catch (err) {
        console.error('[file-sync] Error reading new file:', err)
      }
    })
  })

  watcher.on('change', (filePath) => {
    const relativePath = getRelativePath(projectDir, filePath)
    if (relativePath.startsWith('..')) return

    const key = `${projectName}:change:${relativePath}`
    debounce(key, () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        if (browserWindow && !browserWindow.isDestroyed()) {
          browserWindow.webContents.send('file-sync:changed', {
            projectName,
            projectId,
            filename: relativePath,
            content,
          })
          console.log(`[file-sync] Detected change: ${relativePath}`)
        }
      } catch (err) {
        console.error('[file-sync] Error reading changed file:', err)
      }
    })
  })

  watcher.on('unlink', (filePath) => {
    const relativePath = getRelativePath(projectDir, filePath)
    if (relativePath.startsWith('..')) return

    const key = `${projectName}:unlink:${relativePath}`
    debounce(key, () => {
      if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.webContents.send('file-sync:deleted', {
          projectName,
          projectId,
          filename: relativePath,
        })
        console.log(`[file-sync] Detected deletion: ${relativePath}`)
      }
    })
  })

  watcher.on('addDir', (dirPath) => {
    // New folder created - just log, frontend will discover on refresh
    const relativePath = getRelativePath(projectDir, dirPath)
    if (!relativePath.startsWith('..')) {
      console.log(`[file-sync] New directory: ${relativePath}`)
    }
  })

  watcher.on('error', (error) => {
    console.error(`[file-sync] Watcher error for ${projectName}:`, error)
  })

  watchers.set(projectName, watcher)
  console.log(`[file-sync] Started watching: ${projectDir}`)

  return watcher
}

function stopFileWatcher(projectName) {
  const watcher = watchers.get(projectName)
  if (watcher) {
    watcher.close()
    watchers.delete(projectName)
    console.log(`[file-sync] Stopped watching: ${projectName}`)
  }
}

function stopAllWatchers() {
  for (const [name, watcher] of watchers) {
    watcher.close()
    console.log(`[file-sync] Stopped watching: ${name}`)
  }
  watchers.clear()
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Store reference to main window for sending events
let mainWindow = null

function setMainWindow(win) {
  mainWindow = win
}

ipcMain.handle('file-sync:write', (event, { projectName, filename, content }) => {
  try {
    const dir = ensureProjectDir(projectName)
    const filePath = resolveFilePath(dir, filename)

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')

    console.log(`[file-sync] Written: ${filePath}`)
    return { ok: true, path: filePath }
  } catch (err) {
    console.error('[file-sync] Write error:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:delete', (event, { projectName, filename }) => {
  try {
    const dir = getProjectDir(projectName)
    const filePath = resolveFilePath(dir, filename)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log(`[file-sync] Deleted: ${filePath}`)
    }
    return { ok: true }
  } catch (err) {
    console.error('[file-sync] Delete error:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:get-path', (event, { projectName }) => {
  try {
    const dir = ensureProjectDir(projectName)
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:ensure', (event, { projectName }) => {
  try {
    const dir = ensureProjectDir(projectName)
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:start-watch', (event, { projectName, projectId }) => {
  try {
    if (!mainWindow) {
      return { ok: false, error: 'Main window not available' }
    }
    startFileWatcher(projectName, projectId, mainWindow)
    return { ok: true }
  } catch (err) {
    console.error('[file-sync] Start watch error:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:stop-watch', (event, { projectName }) => {
  try {
    stopFileWatcher(projectName)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:read', (event, { projectName, filename }) => {
  try {
    const dir = getProjectDir(projectName)
    const filePath = resolveFilePath(dir, filename)

    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' }
    }

    const content = fs.readFileSync(filePath, 'utf8')
    return { ok: true, content }
  } catch (err) {
    console.error('[file-sync] Read error:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-sync:list', (event, { projectName }) => {
  try {
    const dir = getProjectDir(projectName)

    if (!fs.existsSync(dir)) {
      return { ok: true, files: [] }
    }

    const files = []
    const walkDir = (currentPath, relativePrefix = '') => {
      const items = fs.readdirSync(currentPath)
      for (const item of items) {
        const fullPath = path.join(currentPath, item)
        const relativePath = path.join(relativePrefix, item)
        const stat = fs.statSync(fullPath)

        // Skip hidden files and common ignore patterns
        if (item.startsWith('.') || item === 'node_modules') continue

        if (stat.isDirectory()) {
          walkDir(fullPath, relativePath)
        } else {
          files.push({
            filename: relativePath.replace(/\\/g, '/'),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          })
        }
      }
    }

    walkDir(dir)
    return { ok: true, files }
  } catch (err) {
    console.error('[file-sync] List error:', err)
    return { ok: false, error: err.message }
  }
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('before-quit', () => {
  stopAllWatchers()
})

module.exports = {
  getProjectDir,
  ensureProjectDir,
  setMainWindow,
  startFileWatcher,
  stopFileWatcher,
  stopAllWatchers,
}
