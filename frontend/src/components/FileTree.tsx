// frontend/src/components/FileTree.tsx
import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  FilePlus, FolderPlus, Trash2, Edit2, Check, X
} from 'lucide-react'

interface WorkspaceFile {
  id: string
  filename: string
  language: string
}

interface TreeNode {
  name: string          // just the last segment, e.g. "main.py" or "backend"
  path: string          // full path, e.g. "backend/main.py" or "backend"
  isFolder: boolean
  children: TreeNode[]
  file?: WorkspaceFile  // only for leaf nodes
}

export interface FileTreeProps {
  files: WorkspaceFile[]
  activeFileId?: string
  pendingDiffFilenames: string[]
  onOpenFile: (file: WorkspaceFile) => void
  onDeleteFile: (file: WorkspaceFile) => void
  onCreateFile: (path: string) => void      // path includes folder prefix
  onCreateFolder: (path: string) => void
  onRenameFile: (file: WorkspaceFile, newName: string) => void
  triggerRootCreate?: { type: 'file' | 'folder' } | null
  onRootCreateDone?: () => void
  renamingFileId?: string | null
  onRenameDone?: () => void
}

/** Build tree structure from flat file list */
function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = []
  const folderMap = new Map<string, TreeNode>()

  // Sort: folders first, then files, alphabetically
  const sorted = [...files].sort((a, b) => {
    const aDepth = a.filename.split('/').length
    const bDepth = b.filename.split('/').length
    return aDepth !== bDepth ? bDepth - aDepth : a.filename.localeCompare(b.filename)
  })

  function getOrCreateFolder(parts: string[], upTo: number): TreeNode {
    const path = parts.slice(0, upTo).join('/')
    if (folderMap.has(path)) return folderMap.get(path)!
    const node: TreeNode = {
      name: parts[upTo - 1],
      path,
      isFolder: true,
      children: []
    }
    folderMap.set(path, node)
    if (upTo === 1) {
      root.push(node)
    } else {
      const parent = getOrCreateFolder(parts, upTo - 1)
      parent.children.push(node)
    }
    return node
  }

  for (const file of files) {
    const parts = file.filename.split('/')
    if (parts.length === 1) {
      // Root-level file
      if (file.filename !== '.gitkeep') {
        root.push({ name: file.filename, path: file.filename, isFolder: false, children: [], file })
      }
    } else {
      // File inside a folder
      const folderParts = parts.slice(0, -1)
      const folder = getOrCreateFolder(parts, folderParts.length)
      if (parts[parts.length - 1] !== '.gitkeep') {
        folder.children.push({
          name: parts[parts.length - 1],
          path: file.filename,
          isFolder: false,
          children: [],
          file
        })
      }
    }
  }

  // Sort each folder's children: folders first, then files
  function sortNode(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    node.children.forEach(sortNode)
  }
  root.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  root.forEach(sortNode)

  return root
}

function langIcon(lang: string): string {
  const map: Record<string, string> = {
    python: '🐍', javascript: '🟨', typescript: '🔷', tsx: '⚛️', jsx: '⚛️',
    html: '🌐', css: '🎨', json: '📋', markdown: '📝', rust: '🦀',
    go: '🐹', sql: '🗄️', shell: '💲', plaintext: '📄',
  }
  return map[lang] || '📄'
}

export function FileTree({
  files, activeFileId, pendingDiffFilenames,
  onOpenFile, onDeleteFile, onCreateFile, onCreateFolder, onRenameFile,
  triggerRootCreate, onRootCreateDone, renamingFileId, onRenameDone
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [inlineCreate, setInlineCreate] = useState<{ parentPath: string; type: 'file' | 'folder' } | null>(null)
  const [inlineRename, setInlineRename] = useState<{ node: TreeNode; value: string } | null>(null)
  const [inlineValue, setInlineValue] = useState('')
  const inlineRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inlineRef.current?.focus() }, [inlineCreate, inlineRename])

  // Handle external trigger for root-level create
  useEffect(() => {
    if (triggerRootCreate) {
      setInlineCreate({ parentPath: '', type: triggerRootCreate.type })
      setInlineValue('')
      onRootCreateDone?.()
    }
  }, [triggerRootCreate])

  // Handle external trigger for rename (e.g. F2 key)
  useEffect(() => {
    if (renamingFileId) {
      const file = files.find(f => f.id === renamingFileId)
      if (file) {
        const parts = file.filename.split('/')
        const name = parts[parts.length - 1]
        setInlineRename({
          node: { name, path: file.filename, isFolder: false, children: [], file },
          value: name
        })
        setInlineValue(name)
      }
      onRenameDone?.()
    }
  }, [renamingFileId])

  const tree = buildTree(files)

  function toggleFolder(path: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  function startInlineCreate(parentPath: string, type: 'file' | 'folder', e: React.MouseEvent) {
    e.stopPropagation()
    // Auto-expand the folder
    setCollapsed(prev => { const n = new Set(prev); n.delete(parentPath); return n })
    setInlineCreate({ parentPath, type })
    setInlineValue('')
  }

  function commitInlineCreate() {
    if (!inlineCreate || !inlineValue.trim()) { setInlineCreate(null); return }
    const fullPath = inlineCreate.parentPath
      ? `${inlineCreate.parentPath}/${inlineValue.trim()}`
      : inlineValue.trim()
    if (inlineCreate.type === 'file') onCreateFile(fullPath)
    else onCreateFolder(fullPath)
    setInlineCreate(null)
    setInlineValue('')
  }

  function startInlineRename(node: TreeNode, e: React.MouseEvent) {
    e.stopPropagation()
    setInlineRename({ node, value: node.name })
    setInlineValue(node.name)
  }

  function commitInlineRename() {
    if (!inlineRename || !inlineValue.trim()) { setInlineRename(null); return }
    if (inlineRename.node.file) {
      const parts = inlineRename.node.path.split('/')
      parts[parts.length - 1] = inlineValue.trim()
      onRenameFile(inlineRename.node.file, parts.join('/'))
    }
    setInlineRename(null)
  }

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)
  useEffect(() => {
    const handler = () => setCtxMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isOpen = !collapsed.has(node.path)
    const isActive = !node.isFolder && node.file?.id === activeFileId
    const hasDiff = !node.isFolder && pendingDiffFilenames.includes(node.file?.filename || '')
    const isHovered = hoveredPath === node.path
    const isRenaming = inlineRename?.node.path === node.path

    return (
      <React.Fragment key={node.path}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            paddingLeft: 8 + depth * 12,
            paddingRight: 6,
            height: 26,
            cursor: 'pointer',
            background: isActive ? 'var(--bg2)' : isHovered ? 'var(--bg2)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            position: 'relative',
            userSelect: 'none',
          }}
          onClick={() => {
            if (node.isFolder) toggleFolder(node.path)
            else if (node.file) onOpenFile(node.file)
          }}
          onMouseEnter={() => setHoveredPath(node.path)}
          onMouseLeave={() => setHoveredPath(null)}
          onContextMenu={e => {
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY, node })
          }}
        >
          {/* Chevron for folders */}
          {node.isFolder ? (
            <span style={{ color: 'var(--text-dim)', flexShrink: 0, width: 12, display: 'flex', alignItems: 'center' }}>
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          ) : (
            <span style={{ width: 12, flexShrink: 0 }} />
          )}

          {/* Icon */}
          <span style={{ fontSize: 13, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {node.isFolder
              ? (isOpen ? <FolderOpen size={14} style={{ color: '#e8c07d' }} /> : <Folder size={14} style={{ color: '#e8c07d' }} />)
              : langIcon(node.file?.language || 'plaintext')
            }
          </span>

          {/* Name or rename input */}
          {isRenaming ? (
            <input
              ref={inlineRef}
              value={inlineValue}
              onChange={e => setInlineValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitInlineRename()
                if (e.key === 'Escape') setInlineRename(null)
              }}
              onBlur={commitInlineRename}
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1, background: 'var(--bg3)', border: '1px solid var(--accent)',
                color: 'var(--text)', fontSize: 12, padding: '1px 4px', borderRadius: 3,
                fontFamily: 'var(--font-mono)', outline: 'none'
              }}
            />
          ) : (
            <span style={{
              flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              {node.name}
            </span>
          )}

          {/* Badges + hover actions */}
          {hasDiff && (
            <span className="tag tag-amber" style={{ fontSize: 9, padding: '1px 4px', flexShrink: 0 }}>diff</span>
          )}

          {isHovered && !isRenaming && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              {node.isFolder && (
                <>
                  <button
                    title="New file in folder"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, borderRadius: 3 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}
                    onClick={e => startInlineCreate(node.path, 'file', e)}
                  ><FilePlus size={11} /></button>
                  <button
                    title="New subfolder"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, borderRadius: 3 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}
                    onClick={e => startInlineCreate(node.path, 'folder', e)}
                  ><FolderPlus size={11} /></button>
                </>
              )}
              {!node.isFolder && (
                <button
                  title="Rename (F2)"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, borderRadius: 3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}
                  onClick={e => startInlineRename(node, e)}
                ><Edit2 size={11} /></button>
              )}
              <button
                title="Delete"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2, borderRadius: 3 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--red)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'}
                onClick={e => { e.stopPropagation(); if (node.file) onDeleteFile(node.file) }}
              ><Trash2 size={11} /></button>
            </div>
          )}
        </div>

        {/* Inline create input */}
        {inlineCreate && inlineCreate.parentPath === node.path && node.isFolder && isOpen && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            paddingLeft: 8 + (depth + 1) * 12 + 16,
            paddingRight: 6, height: 26,
          }}>
            <span style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
              {inlineCreate.type === 'folder' ? <Folder size={13} style={{ color: '#e8c07d' }} /> : '📄'}
            </span>
            <input
              ref={inlineRef}
              value={inlineValue}
              placeholder={inlineCreate.type === 'folder' ? 'folder name' : 'filename.py'}
              onChange={e => setInlineValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitInlineCreate()
                if (e.key === 'Escape') setInlineCreate(null)
              }}
              onBlur={commitInlineCreate}
              style={{
                flex: 1, background: 'var(--bg3)', border: '1px solid var(--accent)',
                color: 'var(--text)', fontSize: 12, padding: '1px 6px', borderRadius: 3,
                fontFamily: 'var(--font-mono)', outline: 'none'
              }}
            />
          </div>
        )}

        {/* Children */}
        {node.isFolder && isOpen && node.children.map(child => renderNode(child, depth + 1))}
      </React.Fragment>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {/* Root-level inline create */}
      {inlineCreate && inlineCreate.parentPath === '' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ display: 'flex', alignItems: 'center' }}>{inlineCreate.type === 'folder' ? <Folder size={13} style={{ color: '#e8c07d' }} /> : '📄'}</span>
          <input
            ref={inlineRef}
            value={inlineValue}
            placeholder={inlineCreate.type === 'folder' ? 'folder name' : 'filename.py'}
            onChange={e => setInlineValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitInlineCreate()
              if (e.key === 'Escape') setInlineCreate(null)
            }}
            onBlur={commitInlineCreate}
            style={{
              flex: 1, background: 'var(--bg3)', border: '1px solid var(--accent)',
              color: 'var(--text)', fontSize: 12, padding: '2px 6px', borderRadius: 3,
              fontFamily: 'var(--font-mono)', outline: 'none'
            }}
          />
          <button onClick={commitInlineCreate} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)' }}><Check size={13} /></button>
          <button onClick={() => setInlineCreate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={13} /></button>
        </div>
      )}

      {tree.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>
          No files yet.<br />Ask <code style={{ color: 'var(--accent)' }}>@agent</code> to create one!
        </div>
      ) : (
        tree.map(node => renderNode(node, 0))
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 0', minWidth: 180,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            fontSize: 13, fontFamily: 'var(--font-display)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {ctxMenu.node.isFolder ? (
            <>
              <CtxItem icon={<FilePlus size={12} />} label="New File" onClick={() => { startInlineCreate(ctxMenu.node.path, 'file', { stopPropagation: () => {} } as any); setCtxMenu(null) }} />
              <CtxItem icon={<FolderPlus size={12} />} label="New Folder" onClick={() => { startInlineCreate(ctxMenu.node.path, 'folder', { stopPropagation: () => {} } as any); setCtxMenu(null) }} />
            </>
          ) : (
            <>
              <CtxItem icon={<Edit2 size={12} />} label="Rename  F2" onClick={() => { startInlineRename(ctxMenu.node, { stopPropagation: () => {} } as any); setCtxMenu(null) }} />
              <CtxItem icon={<Trash2 size={12} />} label="Delete" danger onClick={() => { if (ctxMenu.node.file) onDeleteFile(ctxMenu.node.file); setCtxMenu(null) }} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CtxItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px', cursor: 'pointer',
        color: danger ? 'var(--red)' : 'var(--text-muted)',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg3)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      {icon} {label}
    </div>
  )
}
