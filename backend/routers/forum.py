"""
routers/forum.py — Open Forum / Public Projects
Endpoints:
  GET  /forum/                     → list all public projects (no auth needed)
  POST /forum/create               → create a public project
  GET  /forum/{project_id}         → get public project details + live viewer count
  POST /forum/{project_id}/request → request to join (write access)
  GET  /forum/{project_id}/requests → list join requests (owner/admin only)
  POST /forum/{project_id}/approve/{user_id} → approve request
  POST /forum/{project_id}/reject/{user_id}  → reject request
  POST /forum/{project_id}/view    → register as viewer (anon or auth)
  DELETE /forum/{project_id}/view  → leave viewer list
"""
import uuid, secrets
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel
from typing import Optional
from core.database import get_db, DB_PATH
from core.auth import get_current_user
import aiosqlite

router = APIRouter()

# ── Optional auth — some endpoints work both logged in and out ────────────────

async def optional_auth(request: Request) -> Optional[dict]:
    try:
        from fastapi.security import HTTPBearer
        from core.auth import decode_token
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            return decode_token(auth[7:])
    except Exception:
        pass
    return None

# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_live_viewer_count(project_id: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) as c FROM project_viewers WHERE project_id=?", (project_id,)
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row else 0

async def _get_member_role(project_id: str, user_id: str, db) -> Optional[str]:
    async with db.execute(
        "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, user_id)
    ) as cur:
        row = await cur.fetchone()
    return row["role"] if row else None

# ── Models ────────────────────────────────────────────────────────────────────

class CreatePublicProjectRequest(BaseModel):
    name: str
    description: str = ""
    tags: str = ""  # comma-separated: "python,saas,ml"

class JoinRequestBody(BaseModel):
    message: str = ""

# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_public_projects(
    search: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    db=Depends(get_db)
):
    """Public feed — no auth required."""
    query = """
        SELECT p.id, p.name, p.description, p.tags, p.created_at,
               u.username as owner_name, u.avatar_color as owner_color,
               (SELECT COUNT(*) FROM project_members WHERE project_id=p.id) as member_count,
               (SELECT COUNT(*) FROM project_viewers WHERE project_id=p.id) as viewer_count,
               (SELECT COUNT(*) FROM messages WHERE project_id=p.id) as message_count,
               (SELECT COUNT(*) FROM messages WHERE project_id=p.id AND is_agent=1) as agent_count,
               (SELECT created_at FROM messages WHERE project_id=p.id ORDER BY created_at DESC LIMIT 1) as last_activity
        FROM projects p
        JOIN users u ON u.id = p.owner_id
        WHERE p.is_public = 1
    """
    params = []
    if search:
        query += " AND (p.name LIKE ? OR p.description LIKE ?)"
        params += [f"%{search}%", f"%{search}%"]
    if tag:
        query += " AND p.tags LIKE ?"
        params += [f"%{tag}%"]
    query += " ORDER BY last_activity DESC NULLS LAST, p.created_at DESC LIMIT 50"

    async with db.execute(query, params) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.post("/create")
async def create_public_project(
    body: CreatePublicProjectRequest,
    current=Depends(get_current_user),
    db=Depends(get_db)
):
    project_id  = str(uuid.uuid4())
    invite_code = secrets.token_urlsafe(8)
    await db.execute(
        "INSERT INTO projects (id, name, description, owner_id, invite_code, is_public, tags) VALUES (?,?,?,?,?,1,?)",
        (project_id, body.name, body.description, current["sub"], invite_code, body.tags)
    )
    # Add owner as member with 'owner' role
    await db.execute(
        "INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,'owner')",
        (project_id, current["sub"])
    )
    await db.commit()
    return {"id": project_id, "name": body.name, "invite_code": invite_code}

@router.get("/{project_id}")
async def get_public_project(project_id: str, db=Depends(get_db)):
    async with db.execute("""
        SELECT p.*, u.username as owner_name, u.avatar_color as owner_color,
               (SELECT COUNT(*) FROM project_members WHERE project_id=p.id) as member_count,
               (SELECT COUNT(*) FROM project_viewers  WHERE project_id=p.id) as viewer_count,
               (SELECT COUNT(*) FROM messages WHERE project_id=p.id AND is_agent=1) as agent_calls
        FROM projects p JOIN users u ON u.id=p.owner_id
        WHERE p.id=? AND p.is_public=1
    """, (project_id,)) as cur:
        project = await cur.fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or not public")

    async with db.execute("""
        SELECT u.id, u.username, u.avatar_color, pm.model, pm.role
        FROM project_members pm JOIN users u ON u.id=pm.user_id
        WHERE pm.project_id=?
    """, (project_id,)) as cur:
        members = await cur.fetchall()

    return {**dict(project), "members": [dict(m) for m in members]}

@router.post("/{project_id}/view")
async def join_as_viewer(project_id: str, request: Request, db=Depends(get_db)):
    """Register presence as a viewer. Call on page load, remove on leave."""
    user = await optional_auth(request)
    viewer_id = user["sub"] if user else f"anon_{request.client.host}"
    try:
        await db.execute(
            "INSERT OR IGNORE INTO project_viewers (project_id, user_id) VALUES (?,?)",
            (project_id, viewer_id)
        )
        await db.commit()
    except Exception:
        pass
    count = await _get_live_viewer_count(project_id)
    return {"viewer_count": count}

@router.delete("/{project_id}/view")
async def leave_as_viewer(project_id: str, request: Request, db=Depends(get_db)):
    user = await optional_auth(request)
    viewer_id = user["sub"] if user else f"anon_{request.client.host}"
    await db.execute(
        "DELETE FROM project_viewers WHERE project_id=? AND user_id=?",
        (project_id, viewer_id)
    )
    await db.commit()
    count = await _get_live_viewer_count(project_id)
    return {"viewer_count": count}

@router.post("/{project_id}/request")
async def request_to_join(
    project_id: str,
    body: JoinRequestBody,
    current=Depends(get_current_user),
    db=Depends(get_db)
):
    # Check project is public
    async with db.execute("SELECT id FROM projects WHERE id=? AND is_public=1", (project_id,)) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Public project not found")
    # Check if already a member
    async with db.execute(
        "SELECT user_id FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, current["sub"])
    ) as cur:
        if await cur.fetchone():
            raise HTTPException(status_code=400, detail="Already a member")
    try:
        req_id = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO join_requests (id, project_id, user_id, message) VALUES (?,?,?,?)",
            (req_id, project_id, current["sub"], body.message)
        )
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Request already pending")
    return {"ok": True, "message": "Request sent to project owner"}

@router.get("/{project_id}/requests")
async def list_join_requests(
    project_id: str,
    current=Depends(get_current_user),
    db=Depends(get_db)
):
    # Must be owner or member with role
    async with db.execute(
        "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, current["sub"])
    ) as cur:
        membership = await cur.fetchone()
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member")

    async with db.execute("""
        SELECT jr.*, u.username, u.avatar_color
        FROM join_requests jr JOIN users u ON u.id=jr.user_id
        WHERE jr.project_id=? AND jr.status='pending'
        ORDER BY jr.created_at DESC
    """, (project_id,)) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.post("/{project_id}/approve/{user_id}")
async def approve_request(
    project_id: str,
    user_id: str,
    current=Depends(get_current_user),
    db=Depends(get_db)
):
    async with db.execute(
        "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, current["sub"])
    ) as cur:
        membership = await cur.fetchone()
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member")
    if membership["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only project owner or admin can approve join requests")

    await db.execute(
        "UPDATE join_requests SET status='approved' WHERE project_id=? AND user_id=?",
        (project_id, user_id)
    )
    try:
        await db.execute(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,'member')",
            (project_id, user_id)
        )
    except Exception:
        pass
    await db.commit()
    return {"ok": True}

@router.post("/{project_id}/reject/{user_id}")
async def reject_request(
    project_id: str,
    user_id: str,
    current=Depends(get_current_user),
    db=Depends(get_db)
):
    async with db.execute(
        "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, current["sub"])
    ) as cur:
        membership = await cur.fetchone()
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member")
    if membership["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only project owner or admin can reject join requests")
    await db.execute(
        "UPDATE join_requests SET status='rejected' WHERE project_id=? AND user_id=?",
        (project_id, user_id)
    )
    await db.commit()
    return {"ok": True}
