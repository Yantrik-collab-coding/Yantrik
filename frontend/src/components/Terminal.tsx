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

  // ── Render: Web fallback (existing run-output panel) ─────────────────────────

  return (
    <div style={{
      height: 220,
      background: '#0d1117',
      borderTop: '1px solid var(--border)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '6px 12px', borderBottom: '1px solid #21262d', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', fontFamily: 'var(--font-mono)', flex: 1 }}>
          ⬛ TERMINAL {activeFilename ? `— ${activeFilename}` : ''}
        </span>
        {running && (
          <span style={{ fontSize: 10, color: '#f0a500', fontFamily: 'var(--font-mono)', marginRight: 10 }}>
            ● running...
          </span>
        )}
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', fontSize: 14 }}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
        {!runOutput && running && (
          <span style={{ color: '#7d8590' }}>Running {activeFilename}...</span>
        )}
        {!runOutput && !running && (
          <span style={{ color: '#7d8590' }}>
            Press ▶ Run to execute the current file.<br /><br />
            <span style={{ color: '#f0a500' }}>
              🖥 Full interactive terminal is available in Yantrik Desktop.
            </span>
          </span>
        )}
        {runOutput && (
          <>
            {runOutput.stdout && (
              <pre style={{ color: '#e6edf3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {runOutput.stdout}
              </pre>
            )}
            {runOutput.stderr && (
              <pre style={{ color: runOutput.exit_code === 0 ? '#7d8590' : '#f85149', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {runOutput.stderr}
              </pre>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: runOutput.exit_code === 0 ? '#3fb950' : '#f85149' }}>
              {runOutput.exit_code === 0 ? '✓ Process exited successfully' : `✗ Process exited with code ${runOutput.exit_code}`}
            </div>
          </>
        )}
      </div>
    </div>
  )
}