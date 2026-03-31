"""
routers/files.py — Workspace file management + diff Accept/Reject + version history

File limits per tier:
  Free  : 10 files, 50KB  per file
  BYOK  : 50 files, 200KB per file
  Ollama: 100 files, 500KB per file
"""
import uuid, io, zipfile
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from core.database import get_db, DB_PATH
from core.auth import get_current_user
import aiosqlite

router = APIRouter()

# ── Tier limits ───────────────────────────────────────────────────────────────

TIER_LIMITS = {
    "free":   {"max_files": 10,  "max_bytes": 50  * 1024},        # 50KB
    "byok":   {"max_files": 50,  "max_bytes": 200 * 1024},        # 200KB
    "ollama": {"max_files": 100, "max_bytes": 500 * 1024},        # 500KB
}

async def _get_user_tier(user_id: str, db) -> str:
    async with db.execute(
        "SELECT byok_enabled, ollama_enabled FROM users WHERE id=?", (user_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return "free"
    if row["ollama_enabled"]:
        return "ollama"
    if row["byok_enabled"]:
        return "byok"
    return "free"

async def _check_file_limits(project_id: str, user_id: str, content: str, db):
    """Raises HTTPException if user is over their tier's file or size limit."""
    tier   = await _get_user_tier(user_id, db)
    limits = TIER_LIMITS[tier]

    # Check file count
    async with db.execute(
        "SELECT COUNT(*) as c FROM workspace_files WHERE project_id=?", (project_id,)
    ) as cur:
        row = await cur.fetchone()
    file_count = row["c"] if row else 0

    if file_count >= limits["max_files"]:
        upgrade_msg = ""
        if tier == "free":
            upgrade_msg = " Upgrade to BYOK (₹25/mo) for up to 50 files."
        elif tier == "byok":
            upgrade_msg = " Upgrade to Ollama plan (₹35/mo) for up to 100 files."
        raise HTTPException(
            status_code=400,
            detail=f"File limit reached ({limits['max_files']} files on {tier} plan).{upgrade_msg}"
        )

    # Check file size
    size_bytes = len(content.encode("utf-8"))
    if size_bytes > limits["max_bytes"]:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({size_bytes // 1024}KB). Limit is {limits['max_bytes'] // 1024}KB on {tier} plan."
        )

async def _check_size_only(user_id: str, content: str, db):
    """For updates — only check size, not count."""
    tier   = await _get_user_tier(user_id, db)
    limits = TIER_LIMITS[tier]
    size_bytes = len(content.encode("utf-8"))
    if size_bytes > limits["max_bytes"]:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({size_bytes // 1024}KB). Limit is {limits['max_bytes'] // 1024}KB on {tier} plan."
        )

# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateFileRequest(BaseModel):
    filename: str
    content:  str = ""
    language: str = ""

class UpdateFileRequest(BaseModel):
    content: str
    message: str = "Manual save"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _detect_language(filename: str) -> str:
    ext_map = {
        ".py": "python", ".ts": "typescript", ".tsx": "typescript",
        ".js": "javascript", ".jsx": "javascript", ".html": "html",
        ".css": "css", ".json": "json", ".md": "markdown",
        ".sh": "bash", ".yaml": "yaml", ".yml": "yaml",
        ".sql": "sql", ".rs": "rust", ".go": "go", ".cpp": "cpp",
        ".c": "c", ".java": "java", ".rb": "ruby", ".php": "php",
    }
    for ext, lang in ext_map.items():
        if filename.endswith(ext):
            return lang
    return "plaintext"

async def _assert_member(project_id: str, user_id: str, db):
    async with db.execute(
        "SELECT 1 FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, user_id)
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=403, detail="Not a member of this project")

async def _save_version(file_id: str, project_id: str, content: str, saved_by: str, message: str, db):
    vid = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO file_versions (id, file_id, project_id, content, saved_by, message) VALUES (?,?,?,?,?,?)",
        (vid, file_id, project_id, content, saved_by, message)
    )

# ── File CRUD ─────────────────────────────────────────────────────────────────

@router.get("/{project_id}/files")
async def list_files(project_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute(
        "SELECT id, filename, language, created_by, created_at, updated_at FROM workspace_files WHERE project_id=? ORDER BY filename ASC",
        (project_id,)
    ) as cur:
        rows = await cur.fetchall()

    # Also return tier info so frontend can show limits
    tier   = await _get_user_tier(current["sub"], db)
    limits = TIER_LIMITS[tier]
    return {
        "files": [dict(r) for r in rows],
        "tier": tier,
        "file_count": len(rows),
        "max_files": limits["max_files"],
        "max_kb": limits["max_bytes"] // 1024,
    }

@router.get("/{project_id}/files/{file_id}")
async def get_file(project_id: str, file_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute(
        "SELECT * FROM workspace_files WHERE id=? AND project_id=?",
        (file_id, project_id)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return dict(row)

@router.post("/{project_id}/files")
async def create_file(project_id: str, body: CreateFileRequest, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)

    # Validate filename
    if not body.filename.strip():
        raise HTTPException(status_code=400, detail="Filename cannot be empty")
    if "/" in body.filename or "\\" in body.filename:
        raise HTTPException(status_code=400, detail="Filename cannot contain path separators")
    if len(body.filename) > 100:
        raise HTTPException(status_code=400, detail="Filename too long (max 100 chars)")

    # Check tier limits
    await _check_file_limits(project_id, current["sub"], body.content, db)

    file_id = str(uuid.uuid4())
    lang    = body.language or _detect_language(body.filename)
    try:
        await db.execute(
            "INSERT INTO workspace_files (id, project_id, filename, content, language, created_by) VALUES (?,?,?,?,?,?)",
            (file_id, project_id, body.filename, body.content, lang, current["sub"])
        )
        if body.content:
            await _save_version(file_id, project_id, body.content, current["sub"], "Initial content", db)
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Filename already exists in this project")

    tier   = await _get_user_tier(current["sub"], db)
    limits = TIER_LIMITS[tier]
    async with db.execute("SELECT COUNT(*) as c FROM workspace_files WHERE project_id=?", (project_id,)) as cur:
        count = (await cur.fetchone())["c"]

    return {
        "id": file_id, "filename": body.filename, "language": lang, "content": body.content,
        "file_count": count, "max_files": limits["max_files"], "tier": tier,
    }

@router.put("/{project_id}/files/{file_id}")
async def update_file(project_id: str, file_id: str, body: UpdateFileRequest, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    await _check_size_only(current["sub"], body.content, db)

    async with db.execute("SELECT * FROM workspace_files WHERE id=? AND project_id=?", (file_id, project_id)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    await _save_version(file_id, project_id, row["content"], current["sub"], body.message, db)
    now = datetime.utcnow().isoformat()
    await db.execute("UPDATE workspace_files SET content=?, updated_at=? WHERE id=?", (body.content, now, file_id))
    await db.commit()
    return {"ok": True}

@router.delete("/{project_id}/files/{file_id}")
async def delete_file(project_id: str, file_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    await db.execute("DELETE FROM workspace_files WHERE id=? AND project_id=?", (file_id, project_id))
    await db.commit()
    return {"ok": True}

# ── Tier info endpoint ────────────────────────────────────────────────────────

@router.get("/{project_id}/limits")
async def get_limits(project_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    tier   = await _get_user_tier(current["sub"], db)
    limits = TIER_LIMITS[tier]
    async with db.execute(
        "SELECT COUNT(*) as c FROM workspace_files WHERE project_id=?", (project_id,)
    ) as cur:
        count = (await cur.fetchone())["c"]
    return {
        "tier":       tier,
        "file_count": count,
        "max_files":  limits["max_files"],
        "max_kb":     limits["max_bytes"] // 1024,
        "remaining":  limits["max_files"] - count,
    }

# ── Version history + rollback ────────────────────────────────────────────────

@router.get("/{project_id}/files/{file_id}/versions")
async def get_versions(project_id: str, file_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute(
        "SELECT id, saved_by, message, created_at FROM file_versions WHERE file_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50",
        (file_id, project_id)
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.post("/{project_id}/files/{file_id}/rollback/{version_id}")
async def rollback_file(project_id: str, file_id: str, version_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute(
        "SELECT content FROM file_versions WHERE id=? AND file_id=? AND project_id=?",
        (version_id, file_id, project_id)
    ) as cur:
        ver = await cur.fetchone()
    if not ver:
        raise HTTPException(status_code=404, detail="Version not found")

    async with db.execute("SELECT content FROM workspace_files WHERE id=?", (file_id,)) as cur:
        current_row = await cur.fetchone()
    if current_row:
        await _save_version(file_id, project_id, current_row["content"], current["sub"], "Pre-rollback snapshot", db)

    now = datetime.utcnow().isoformat()
    await db.execute("UPDATE workspace_files SET content=?, updated_at=? WHERE id=?", (ver["content"], now, file_id))
    await db.commit()
    return {"ok": True, "restored_content": ver["content"]}

# ── Pending diffs ─────────────────────────────────────────────────────────────

@router.get("/{project_id}/diffs")
async def list_diffs(project_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute(
        "SELECT * FROM pending_diffs WHERE project_id=? AND status='pending' ORDER BY created_at ASC",
        (project_id,)
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.post("/{project_id}/diffs/{diff_id}/accept")
async def accept_diff(project_id: str, diff_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute("SELECT * FROM pending_diffs WHERE id=? AND project_id=? AND status='pending'", (diff_id, project_id)) as cur:
        diff = await cur.fetchone()
    if not diff:
        raise HTTPException(status_code=404, detail="Pending diff not found")

    diff = dict(diff)
    now  = datetime.utcnow().isoformat()

    if diff["file_id"]:
        async with db.execute("SELECT content FROM workspace_files WHERE id=?", (diff["file_id"],)) as cur:
            current_file = await cur.fetchone()
        if current_file:
            await _save_version(diff["file_id"], project_id, current_file["content"], "agent", f"Before: {diff['filename']}", db)
        await db.execute("UPDATE workspace_files SET content=?, updated_at=? WHERE id=?", (diff["new_content"], now, diff["file_id"]))
        file_id = diff["file_id"]
    else:
        # New file from agent — also check limits
        await _check_file_limits(project_id, current["sub"], diff["new_content"], db)
        file_id = str(uuid.uuid4())
        lang    = _detect_language(diff["filename"])
        await db.execute(
            "INSERT INTO workspace_files (id, project_id, filename, content, language, created_by) VALUES (?,?,?,?,?,?)",
            (file_id, project_id, diff["filename"], diff["new_content"], lang, "agent")
        )
        await _save_version(file_id, project_id, diff["new_content"], "agent", "Created by agent", db)

    await db.execute("UPDATE pending_diffs SET status='accepted', resolved_at=? WHERE id=?", (now, diff_id))
    await db.commit()
    return {"ok": True, "file_id": file_id, "filename": diff["filename"], "content": diff["new_content"]}

@router.post("/{project_id}/diffs/{diff_id}/reject")
async def reject_diff(project_id: str, diff_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    now = datetime.utcnow().isoformat()
    await db.execute(
        "UPDATE pending_diffs SET status='rejected', resolved_at=? WHERE id=? AND project_id=?",
        (now, diff_id, project_id)
    )
    await db.commit()
    return {"ok": True}

# ── Project download (ZIP) ────────────────────────────────────────────────────

@router.get("/{project_id}/download")
async def download_project(project_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute("SELECT name FROM projects WHERE id=?", (project_id,)) as cur:
        proj = await cur.fetchone()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    async with db.execute(
        "SELECT filename, content FROM workspace_files WHERE project_id=? ORDER BY filename ASC",
        (project_id,)
    ) as cur:
        files = await cur.fetchall()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.writestr(f["filename"], f["content"] or "")
    buf.seek(0)

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in proj["name"])
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'}
    )

# ── Agent jobs history ────────────────────────────────────────────────────────

@router.get("/{project_id}/jobs")
async def list_jobs(project_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    await _assert_member(project_id, current["sub"], db)
    async with db.execute(
        "SELECT id, triggered_by, instruction, model, status, created_at, completed_at FROM agent_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 30",
        (project_id,)
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

# ── Run file ──────────────────────────────────────────────────────────────────

import subprocess, sys, tempfile, os as _os

RUNNABLE = {
    "python": ["python"],
    "javascript": ["node"],
    "typescript": ["npx", "ts-node"],
    "bash": ["bash"],
}

@router.post("/{project_id}/files/{file_id}/run")
async def run_file(project_id: str, file_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    """Execute file content in a sandboxed subprocess. Returns stdout/stderr."""
    await _assert_member(project_id, current["sub"], db)
    async with db.execute("SELECT * FROM workspace_files WHERE id=? AND project_id=?", (file_id, project_id)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    lang = row["language"]
    if lang not in RUNNABLE:
        raise HTTPException(status_code=400, detail=f"Cannot run {lang} files in browser. Coming in desktop app.")

    cmd = RUNNABLE[lang]
    content = row["content"] or ""

    # Write to temp file
    suffix = {"python": ".py", "javascript": ".js", "bash": ".sh"}.get(lang, ".txt")
    # Detect interactive code patterns
    interactive_patterns = ["input(", "raw_input(", "stdin.read", "getpass(", "while True"]
    is_interactive = any(p in content for p in interactive_patterns)
    if is_interactive:
        return {
            "stdout": "",
            "stderr": (
                "⚠️  This file uses interactive input (input(), while True, etc.)\n\n"
                "The browser runner cannot handle interactive programs — it has no keyboard input.\n\n"
                "To run this file:\n"
                "  1. Download it (↓ button in explorer)\n"
                "  2. Run locally: python todo.py\n\n"
                "🖥  Full interactive terminal is coming in the Yantrik Desktop."
            ),
            "exit_code": 2,
        }

    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8") as f:
            f.write(content)
            tmp_path = f.name

        result = subprocess.run(
            cmd + [tmp_path],
            capture_output=True, text=True,
            timeout=10,
            cwd=tempfile.gettempdir(),
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "⏱ Execution timed out (10s limit)\n\nIf your code needs user input, download and run it locally.", "exit_code": 1}
    except FileNotFoundError:
        return {"stdout": "", "stderr": f"Runtime not found: {cmd[0]} is not installed on the server.", "exit_code": 1}
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "exit_code": 1}
    finally:
        try: _os.unlink(tmp_path)
        except: pass

# ── External file sync (from Desktop file watcher) ────────────────────────────

class SyncFileRequest(BaseModel):
    filename: str
    content: str

@router.post("/{project_id}/sync-file")
async def sync_external_file(project_id: str, body: SyncFileRequest, current=Depends(get_current_user), db=Depends(get_db)):
    """
    Sync a file from the local filesystem (changed by external tools like npm/git)
    into the database. Creates new file if not exists, updates if exists.
    """
    await _assert_member(project_id, current["sub"], db)

    # Check size limits
    await _check_size_only(current["sub"], body.content, db)

    # Check if file already exists
    async with db.execute(
        "SELECT id, content FROM workspace_files WHERE project_id=? AND filename=?",
        (project_id, body.filename)
    ) as cur:
        existing = await cur.fetchone()

    if existing:
        # Update existing file - save version first
        if existing["content"] != body.content:
            await _save_version(existing["id"], project_id, existing["content"], "system", "External sync", db)
            now = datetime.utcnow().isoformat()
            await db.execute(
                "UPDATE workspace_files SET content=?, updated_at=? WHERE id=?",
                (body.content, now, existing["id"])
            )
            await db.commit()
            return {"ok": True, "action": "updated", "file_id": existing["id"]}
        return {"ok": True, "action": "unchanged", "file_id": existing["id"]}
    else:
        # Create new file
        await _check_file_limits(project_id, current["sub"], body.content, db)
        file_id = str(uuid.uuid4())
        lang = _detect_language(body.filename)
        await db.execute(
            "INSERT INTO workspace_files (id, project_id, filename, content, language, created_by) VALUES (?,?,?,?,?,?)",
            (file_id, project_id, body.filename, body.content, lang, "system")
        )
        await _save_version(file_id, project_id, body.content, "system", "External sync", db)
        await db.commit()
        return {"ok": True, "action": "created", "file_id": file_id}

@router.delete("/{project_id}/sync-file")
async def delete_external_file(project_id: str, filename: str, current=Depends(get_current_user), db=Depends(get_db)):
    """
    Delete a file from the database when it's deleted from the local filesystem.
    """
    await _assert_member(project_id, current["sub"], db)

    await db.execute(
        "DELETE FROM workspace_files WHERE project_id=? AND filename=?",
        (project_id, filename)
    )
    await db.commit()
    return {"ok": True}
