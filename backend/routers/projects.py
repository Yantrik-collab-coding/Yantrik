from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from core.database import get_db
from core.auth import get_current_user, decode_token
import uuid, secrets

router = APIRouter()

class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""

class UpdateModelRequest(BaseModel):
    model: str

@router.get("/models")
async def get_models(current=Depends(get_current_user), db=Depends(get_db)):
    from core.models import ALL_MODELS
    from core.launch import is_free_window
    if is_free_window():
        # All models available to everyone during the launch free window
        return [{**m, "available": True} for m in ALL_MODELS]
    async with db.execute(
        "SELECT byok_enabled, ollama_enabled FROM users WHERE id=?", (current["sub"],)
    ) as cur:
        row = await cur.fetchone()
    byok   = bool(row["byok_enabled"])   if row else False
    ollama = bool(row["ollama_enabled"]) if row else False
    result = []
    for m in ALL_MODELS:
        available = (
            m["tier"] == "free" or
            (m["tier"] == "byok"   and byok) or
            (m["tier"] == "ollama" and ollama)
        )
        result.append({**m, "available": available})
    return result

@router.post("/")
async def create_project(body: CreateProjectRequest, current=Depends(get_current_user), db=Depends(get_db)):
    project_id = str(uuid.uuid4())
    invite_code = secrets.token_urlsafe(8)
    await db.execute(
        "INSERT INTO projects (id, name, description, owner_id, invite_code) VALUES (?,?,?,?,?)",
        (project_id, body.name, body.description, current["sub"], invite_code)
    )
    await db.execute(
        "INSERT INTO project_members (project_id, user_id) VALUES (?,?)",
        (project_id, current["sub"])
    )
    await db.commit()
    return {"id": project_id, "name": body.name, "description": body.description, "invite_code": invite_code}

@router.get("/")
async def list_projects(current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("""
        SELECT p.*, pm.model as my_model,
               (SELECT COUNT(*) FROM project_members WHERE project_id=p.id) as member_count
        FROM projects p
        JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=?
        ORDER BY p.created_at DESC
    """, (current["sub"],)) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.get("/{project_id}")
async def get_project(project_id: str, current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM projects WHERE id=?", (project_id,)) as cur:
        project = await cur.fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    async with db.execute("""
        SELECT u.id, u.username, u.avatar_color, pm.model, pm.joined_at
        FROM project_members pm JOIN users u ON u.id=pm.user_id
        WHERE pm.project_id=?
    """, (project_id,)) as cur:
        members = await cur.fetchall()
    async with db.execute(
        "SELECT model FROM project_members WHERE project_id=? AND user_id=?",
        (project_id, current["sub"])
    ) as cur:
        my_membership = await cur.fetchone()
    if not my_membership:
        raise HTTPException(status_code=403, detail="Not a member")
    return {
        **dict(project),
        "members": [dict(m) for m in members],
        "my_model": my_membership["model"]
    }

@router.post("/join/{invite_code}")
async def join_project(invite_code: str, current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM projects WHERE invite_code=?", (invite_code,)) as cur:
        project = await cur.fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    try:
        await db.execute(
            "INSERT INTO project_members (project_id, user_id) VALUES (?,?)",
            (project["id"], current["sub"])
        )
        await db.commit()
    except Exception:
        pass  # Already a member
    return {"id": project["id"], "name": project["name"]}

@router.patch("/{project_id}/model")
async def update_model(project_id: str, body: UpdateModelRequest, current=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "UPDATE project_members SET model=? WHERE project_id=? AND user_id=?",
        (body.model, project_id, current["sub"])
    )
    await db.commit()
    return {"ok": True}

@router.get("/{project_id}/messages")
async def get_messages(project_id: str, request: Request, db=Depends(get_db)):
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
    from core.auth import decode_token
    # Check if public project — allow read without auth
    async with db.execute("SELECT is_public FROM projects WHERE id=?", (project_id,)) as cur:
        proj = await cur.fetchone()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if not proj["is_public"]:
        # Private project — require membership
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Authentication required")
        try:
            payload = decode_token(auth_header[7:])
            user_id = payload["sub"]
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
        async with db.execute(
            "SELECT user_id FROM project_members WHERE project_id=? AND user_id=?",
            (project_id, user_id)
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=403, detail="Not a member")
    async with db.execute(
        "SELECT * FROM messages WHERE project_id=? ORDER BY created_at ASC LIMIT 200",
        (project_id,)
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]
