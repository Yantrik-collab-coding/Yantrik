/**
 * electron/preload.js
 * Yantrik Desktop — Preload (Context Bridge)
 *
 * Exposes a minimal, typed API surface to the renderer via window.electronAPI.
 * Nothing else from Node/Electron leaks into the renderer.
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Terminal / PTY ──────────────────────────────────────────────────────────

  /**
   * Create (or attach to) a PTY session for a project.
   * @param {string} projectId  - Yantrik project UUID
   * @param {string} [cwd]      - Working directory for the shell
   * @returns {Promise<{ok: boolean, existed: boolean, error?: string}>}
   */
  ptyCreate: (projectId, cwd) =>
    ipcRenderer.invoke('pty:create', { projectId, cwd }),

  /**
   * Send raw input (keystrokes) to the PTY.
   */
  ptyWrite: (projectId, data) =>
    ipcRenderer.send('pty:write', { projectId, data }),

  /**
   * Notify the PTY of terminal size changes.
   */
  ptyResize: (projectId, cols, rows) =>
    ipcRenderer.send('pty:resize', { projectId, cols, rows }),

  /**
   * Kill the PTY session for a project.
   */
  ptyKill: (projectId) =>
    ipcRenderer.send('pty:kill', { projectId }),

  /**
   * Subscribe to output from the PTY.
   * @returns {() => void}  cleanup function — call it in useEffect cleanup
   */
  onPtyData: (projectId, callback) => {
    const channel = `pty:data:${projectId}`
    const handler = (_event, data) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /**
   * Subscribe to PTY exit event.
   * @returns {() => void}  cleanup function
   */
  onPtyExit: (projectId, callback) => {
    const channel = `pty:exit:${projectId}`
    const handler = (_event, info) => callback(info)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // ── Backend health ──────────────────────────────────────────────────────────

  /**
   * Fires when the backend process crashes unexpectedly.
   * @returns {() => void}  cleanup function
   */
  onBackendCrash: (callback) => {
    const handler = (_event, info) => callback(info)
    ipcRenderer.on('backend:crashed', handler)
    return () => ipcRenderer.removeListener('backend:crashed', handler)
  },

  // ── File sync ───────────────────────────────────────────────────────────────

  /**
   * Write a file to the local project folder (~/Yantrik/{projectName}/{filename}).
   * Called after an agent diff is accepted.
   * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
   */
  writeFile: (projectName, filename, content) =>
    ipcRenderer.invoke('file-sync:write', { projectName, filename, content }),

  /**
   * Delete a file from the local project folder.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  deleteFile: (projectName, filename) =>
    ipcRenderer.invoke('file-sync:delete', { projectName, filename }),

  /**
   * Get (and create if missing) the absolute path to the project's local folder.
   * Use this as the CWD for the PTY.
   * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
   */
  getProjectPath: (projectName) =>
    ipcRenderer.invoke('file-sync:get-path', { projectName }),

  /**
   * Ensure the project folder exists. Call on project page load,
   * before spawning the terminal.
   * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
   */
  ensureProjectDir: (projectName) =>
    ipcRenderer.invoke('file-sync:ensure', { projectName }),

  /**
   * Start watching a project folder for changes (files created/modified/deleted
   * by external tools like npm, git, etc.)
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  startFileWatcher: (projectName, projectId) =>
    ipcRenderer.invoke('file-sync:start-watch', { projectName, projectId }),

  /**
   * Stop watching a project folder.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  stopFileWatcher: (projectName) =>
    ipcRenderer.invoke('file-sync:stop-watch', { projectName }),

  /**
   * Read a file from the local project folder.
   * @returns {Promise<{ok: boolean, content?: string, error?: string}>}
   */
  readFile: (projectName, filename) =>
    ipcRenderer.invoke('file-sync:read', { projectName, filename }),

  /**
   * List all files in the local project folder (recursive).
   * @returns {Promise<{ok: boolean, files?: Array, error?: string}>}
   */
  listFiles: (projectName) =>
    ipcRenderer.invoke('file-sync:list', { projectName }),

  /**
   * Subscribe to file creation events (from watcher).
   * @returns {() => void} cleanup function
   */
  onFileCreated: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('file-sync:created', handler)
    return () => ipcRenderer.removeListener('file-sync:created', handler)
  },

  /**
   * Subscribe to file change events (from watcher).
   * @returns {() => void} cleanup function
   */
  onFileChanged: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('file-sync:changed', handler)
    return () => ipcRenderer.removeListener('file-sync:changed', handler)
  },

  /**
   * Subscribe to file deletion events (from watcher).
   * @returns {() => void} cleanup function
   */
  onFileDeleted: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('file-sync:deleted', handler)
    return () => ipcRenderer.removeListener('file-sync:deleted', handler)
  },

  // ── Environment ─────────────────────────────────────────────────────────────

  /** True when running inside Electron (vs a normal browser). */
  isDesktop: true,

  /** The host platform. */
  platform: process.platform,
})