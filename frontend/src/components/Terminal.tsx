/**
 * frontend/src/components/Terminal.tsx
 * Yantrik Desktop — Real PTY Terminal
 *
 * Drop-in replacement for the fake "run output" panel in ProjectPage.tsx.
 *
 * When running in Electron (window.electronAPI?.isDesktop === true):
 *   → Connects to a real PTY via the IPC bridge.
 *
 * When running in a browser (web version):
 *   → Falls back to the existing runOutput display (pass runOutput prop).
 *
 * Usage in ProjectPage.tsx:
 *   import Terminal from '../components/Terminal'
 *
 *   // Replace the showTerminal block with:
 *   {showTerminal && (
 *     <Terminal
 *       projectId={id!}
 *       show={showTerminal}
 *       onClose={() => setShowTerminal(false)}
 *       runOutput={runOutput}
 *       running={running}
 *       activeFilename={activeFile?.filename}
 *     />
 *   )}
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'

// xterm.js — only imported when actually needed
// Add to package.json:  "xterm": "^5.3.0", "@xterm/addon-fit": "^0.8.0"
let XTerm: any = null
let FitAddon: any = null

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunOutput {
  stdout: string
  stderr: string
  exit_code: number
}

interface TerminalProps {
  projectId: string
  /** Project display name — used to show the folder path in the header */
  projectName?: string
  /** Absolute path to the project's local folder. PTY spawns here. */
  cwd?: string
  show: boolean
  onClose: () => void
  /** Only used in web/fallback mode */
  runOutput?: RunOutput | null
  running?: boolean
  activeFilename?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True when running inside Electron Desktop */
const isDesktop = () =>
  typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop === true

/** Lazy-load xterm.js (only in Electron, not in browser bundles) */
async function loadXterm() {
  if (XTerm) return { XTerm, FitAddon }
  const [xtermMod, fitMod] = await Promise.all([
    import('xterm'),
    import('@xterm/addon-fit'),
  ])
  XTerm    = xtermMod.Terminal
  FitAddon = fitMod.FitAddon
  return { XTerm, FitAddon }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Terminal({
  projectId,
  projectName,
  cwd,
  show,
  onClose,
  runOutput,
  running,
  activeFilename,
}: TerminalProps) {

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<any>(null)   // xterm Terminal instance
  const fitRef       = useRef<any>(null)   // FitAddon instance
  const cleanupRef   = useRef<(() => void)[]>([])

  // ── Desktop: initialize xterm + PTY ─────────────────────────────────────────

  const initDesktopTerminal = useCallback(async () => {
    if (!containerRef.current || termRef.current) return

    const { XTerm: Term, FitAddon: Fit } = await loadXterm()
    const api = (window as any).electronAPI

    // Create xterm instance
    const term = new Term({
      theme: {
        background:  '#0d1117',
        foreground:  '#e6edf3',
        cursor:      '#58a6ff',
        selectionBackground: '#264f78',
        black:       '#0d1117',
        red:         '#f85149',
        green:       '#3fb950',
        yellow:      '#f0a500',
        blue:        '#58a6ff',
        magenta:     '#bc8cff',
        cyan:        '#39d353',
        white:       '#e6edf3',
        brightBlack: '#484f58',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: true,
    })

    const fit = new Fit()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current  = fit

    // Create PTY session — pass cwd so shell starts in ~/Yantrik/{projectName}/
    const result = await api.ptyCreate(projectId, cwd)
    if (!result.ok) {
      term.write(`\r\n\x1b[31mFailed to start terminal: ${result.error}\x1b[0m\r\n`)
      return
    }

    // Show the working directory on first open
    if (cwd) {
      term.write(`\x1b[2m# ${cwd}\x1b[0m\r\n`)
    }

    // Wire output: PTY → xterm
    const offData = api.onPtyData(projectId, (data: string) => {
      term.write(data)
    })

    const offExit = api.onPtyExit(projectId, ({ exitCode }: { exitCode: number }) => {
      term.write(`\r\n\x1b[2m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
    })

    // Wire input: xterm → PTY
    const disposeInput = term.onData((data: string) => {
      api.ptyWrite(projectId, data)
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return
      try {
        fitRef.current.fit()
        api.ptyResize(projectId, termRef.current.cols, termRef.current.rows)
      } catch {}
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)

    cleanupRef.current.push(
      offData,
      offExit,
      () => disposeInput.dispose(),
      () => resizeObserver.disconnect(),
    )
  }, [projectId, cwd])

  // Mount / unmount
  useEffect(() => {
    if (!show) return
    if (isDesktop()) {
      initDesktopTerminal()
    }
    return () => {
      // Cleanup listeners but keep PTY alive (session persists)
      cleanupRef.current.forEach(fn => fn())
      cleanupRef.current = []
      if (termRef.current) {
        termRef.current.dispose()
        termRef.current = null
        fitRef.current  = null
      }
    }
  }, [show, initDesktopTerminal])

  // ── Render: Desktop ──────────────────────────────────────────────────────────

  if (isDesktop()) {
    return (
      <div style={{
        height: 260,
        background: '#0d1117',
        borderTop: '1px solid #21262d',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '6px 12px', borderBottom: '1px solid #21262d', flexShrink: 0,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
              Terminal
            </span>
            {cwd && (
              <span style={{ fontSize: 11, color: '#484f58', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={cwd}>
                — {cwd}
              </span>
            )}
            {!cwd && activeFilename && (
              <span style={{ fontSize: 11, color: '#484f58', fontFamily: 'var(--font-mono)' }}>
                — {activeFilename}
              </span>
            )}
          </span>
          {/* Traffic-light style dots (purely decorative) */}
          <span style={{ display: 'flex', gap: 5, marginRight: 10, flexShrink: 0 }}>
            {['#ff5f57','#febc2e','#28c840'].map(c => (
              <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.7 }} />
            ))}
          </span>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', fontSize: 14, lineHeight: 1 }}
            onClick={onClose}
            title="Close terminal"
          >
            <X size={13} />
          </button>
        </div>

        {/* xterm.js mount point */}
        <div
          ref={containerRef}
          style={{ flex: 1, padding: '4px 4px', overflow: 'hidden' }}
        />
      </div>
    )
  }

  // ── Render: Web fallback (enhanced terminal-like experience) ──────────────────

  const [cmdInput, setCmdInput] = React.useState('')
  const [cmdHistory, setCmdHistory] = React.useState<{ cmd: string; output: string; exit_code: number }[]>([])
  const [cmdRunning, setCmdRunning] = React.useState(false)
  const [historyIndex, setHistoryIndex] = React.useState(-1)
  const commandLog = React.useRef<string[]>([])
  const webBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    webBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [cmdHistory, runOutput])

  async function runCommand() {
    const cmd = cmdInput.trim()
    if (!cmd || cmdRunning) return
    setCmdInput('')
    setCmdRunning(true)
    try {
      const { default: api } = await import('../lib/api')
      const { data } = await api.post(`/projects/${projectId}/terminal`, { command: cmd })
      setCmdHistory(prev => [...prev, { cmd, output: (data.stdout || '') + (data.stderr || ''), exit_code: data.exit_code }])
    } catch (err: any) {
      setCmdHistory(prev => [...prev, { cmd, output: err?.response?.data?.detail || 'Command execution failed. Terminal commands require the Yantrik Desktop app for full functionality.', exit_code: 1 }])
    } finally {
      setCmdRunning(false)
    }
  }

  return (
    <div style={{
      height: '100%',
      background: '#0d1117',
      borderTop: '1px solid #21262d',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '6px 12px', borderBottom: '1px solid #21262d', flexShrink: 0,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Terminal
          </span>
          {activeFilename && (
            <span style={{ fontSize: 11, color: '#484f58', fontFamily: 'var(--font-mono)' }}>
              — {activeFilename}
            </span>
          )}
        </span>
        {/* Traffic-light dots */}
        <span style={{ display: 'flex', gap: 5, marginRight: 10, flexShrink: 0 }}>
          {['#ff5f57','#febc2e','#28c840'].map(c => (
            <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.7 }} />
          ))}
        </span>
        {running && (
          <span style={{ fontSize: 10, color: '#f0a500', fontFamily: 'var(--font-mono)', marginRight: 10 }}>
            ● running...
          </span>
        )}
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', fontSize: 14, lineHeight: 1 }}
          onClick={onClose}
          title="Close terminal"
        >
          <X size={13} />
        </button>
      </div>

      {/* Terminal output area */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '8px 12px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12, lineHeight: 1.6 }}>
        {/* Empty state */}
        {!runOutput && !running && cmdHistory.length === 0 && (
          <div style={{ color: '#484f58', padding: '8px 0' }}>
            <div style={{ color: '#58a6ff', marginBottom: 4 }}>Yantrik Terminal</div>
            <div style={{ color: '#7d8590' }}>
              Type a command below to run it, or press ▶ Run to execute the active file.
              {!(window as any).electronAPI?.isDesktop && (
                <div style={{ marginTop: 8, color: '#f0a500', fontSize: 11 }}>
                  💡 For full interactive terminal support (npm, git, etc.), use <strong style={{ color: '#e6edf3' }}>Yantrik Desktop</strong>.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Command history */}
        {cmdHistory.map((entry, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ color: '#3fb950', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#58a6ff' }}>❯</span> {entry.cmd}
            </div>
            {entry.output && (
              <pre style={{ color: entry.exit_code === 0 ? '#e6edf3' : '#f85149', margin: '2px 0 0 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {entry.output}
              </pre>
            )}
          </div>
        ))}

        {/* Run output from ▶ Run button */}
        {running && !runOutput && (
          <div style={{ color: '#f0a500', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="typing-dot" /> Running {activeFilename}...
          </div>
        )}
        {runOutput && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#58a6ff', marginBottom: 4 }}>▶ Run: {activeFilename}</div>
            {runOutput.stdout && (
              <pre style={{ color: '#e6edf3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingLeft: 16 }}>
                {runOutput.stdout}
              </pre>
            )}
            {runOutput.stderr && (
              <pre style={{ color: runOutput.exit_code === 0 ? '#7d8590' : '#f85149', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingLeft: 16 }}>
                {runOutput.stderr}
              </pre>
            )}
            <div style={{ marginTop: 4, fontSize: 11, paddingLeft: 16, color: runOutput.exit_code === 0 ? '#3fb950' : '#f85149' }}>
              {runOutput.exit_code === 0 ? '✓ exited successfully' : `✗ exited with code ${runOutput.exit_code}`}
            </div>
          </div>
        )}

        {cmdRunning && (
          <div style={{ color: '#f0a500', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⏳</span> Running command...
          </div>
        )}

        <div ref={webBottomRef} />
      </div>

      {/* Command input bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderTop: '1px solid #21262d',
        background: '#161b22',
      }}>
        <span style={{ color: '#58a6ff', fontSize: 13, flexShrink: 0 }}>❯</span>
        <input
          type="text"
          value={cmdInput}
          onChange={e => setCmdInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (cmdInput.trim()) commandLog.current.unshift(cmdInput.trim())
              setHistoryIndex(-1)
              runCommand()
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              const next = Math.min(historyIndex + 1, commandLog.current.length - 1)
              setHistoryIndex(next)
              if (commandLog.current[next]) setCmdInput(commandLog.current[next])
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              const next = historyIndex - 1
              setHistoryIndex(next)
              setCmdInput(next >= 0 ? commandLog.current[next] : '')
            }
          }}
          placeholder="Type a command..."
          disabled={cmdRunning}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#e6edf3', fontSize: 12, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        />
        <button
          onClick={runCommand}
          disabled={!cmdInput.trim() || cmdRunning}
          style={{
            background: cmdInput.trim() && !cmdRunning ? '#238636' : '#21262d',
            border: 'none', borderRadius: 4, padding: '3px 8px',
            color: cmdInput.trim() && !cmdRunning ? '#fff' : '#484f58',
            fontSize: 11, fontFamily: 'var(--font-mono)', cursor: cmdInput.trim() && !cmdRunning ? 'pointer' : 'not-allowed',
          }}
        >
          Run
        </button>
      </div>
    </div>
  )
}