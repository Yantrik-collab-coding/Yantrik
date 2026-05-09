"""
routers/hackathon.py — Full hackathon system
POST /hackathons/                          → create hackathon (organizer)
GET  /hackathons/                          → list all hackathons
GET  /hackathons/{hid}                     → get hackathon details
POST /hackathons/{hid}/judges/{uid}        → add judge by UID
POST /hackathons/{hid}/teams               → create team (leader registers)
POST /hackathons/{hid}/teams/{tid}/invite/{uid} → leader invites member by UID
POST /hackathons/{hid}/teams/{tid}/join    → accept team invite
GET  /hackathons/{hid}/teams               → list teams + members
GET  /hackathons/{hid}/judge/overview      → judge sees ALL team chats + code
PATCH /hackathons/{hid}/status             → organizer updates status
"""
import uuid, secrets
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from core.database import get_db, DB_PATH
from core.auth import get_current_user
import aiosqlite

router = APIRouter()

# ── Models ────────────────────────────────────────────────────────────────────

class CreateHackathonRequest(BaseModel):
    name: str
    description: str = ""
    max_teams: int = 10
    max_per_team: int = 4
    start_time: Optional[str] = None
    end_time: Optional[str] = None

class CreateTeamRequest(BaseModel):
    name: str

class UpdateStatusRequest(BaseModel):
    status: str  # upcoming | active | ended

# ── Helpers ───────────────────────────────────────────────────────────────────

async def _uid_to_id(uid: str, db) -> Optional[str]:
    async with db.execute("SELECT id FROM users WHERE uid=?", (uid.upper(),)) as cur:
        row = await cur.fetchone()
    return row["id"] if row else None

async def _is_organizer(hid: str, user_id: str, db) -> bool:
    async with db.execute("SELECT id FROM hackathons WHERE id=? AND organizer_id=?", (hid, user_id)) as cur:
        return bool(await cur.fetchone())

async def _is_judge(hid: str, user_id: str, db) -> bool:
    async with db.execute("SELECT 1 FROM hackathon_judges WHERE hackathon_id=? AND user_id=?", (hid, user_id)) as cur:
        return bool(await cur.fetchone())

async def _is_team_leader(tid: str, user_id: str, db) -> bool:
    async with db.execute("SELECT id FROM hackathon_teams WHERE id=? AND leader_id=?", (tid, user_id)) as cur:
        return bool(await cur.fetchone())

async def _get_team_project(tid: str, db) -> Optional[str]:
    async with db.execute("SELECT project_id FROM hackathon_teams WHERE id=?", (tid,)) as cur:
        row = await cur.fetchone()
    return row["project_id"] if row else None

# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/")
async def create_hackathon(body: CreateHackathonRequest, current=Depends(get_current_user), db=Depends(get_db)):
    hid = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO hackathons (id, name, description, organizer_id, max_teams, max_per_team, start_time, end_time) VALUES (?,?,?,?,?,?,?,?)",
        (hid, body.name, body.description, current["sub"], body.max_teams, body.max_per_team, body.start_time, body.end_time)
    )
    # Organizer is also a judge by default
    await db.execute("INSERT INTO hackathon_judges (hackathon_id, user_id) VALUES (?,?)", (hid, current["sub"]))
    await db.commit()
    return {"id": hid, "name": body.name}

@router.get("/")
async def list_hackathons(db=Depends(get_db)):
    async with db.execute("""
        SELECT h.*, u.username as organizer_name, u.avatar_color as organizer_color,
               (SELECT COUNT(*) FROM hackathon_teams WHERE hackathon_id=h.id) as team_count
        FROM hackathons h JOIN users u ON u.id=h.organizer_id
        ORDER BY h.created_at DESC
    """) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.get("/{hid}")
async def get_hackathon(hid: str, current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("""
        SELECT h.*, u.username as organizer_name, u.avatar_color as organizer_color
        FROM hackathons h JOIN users u ON u.id=h.organizer_id WHERE h.id=?
    """, (hid,)) as cur:
        h = await cur.fetchone()
    if not h:
        raise HTTPException(status_code=404, detail="Hackathon not found")

    async with db.execute("""
        SELECT u.id, u.username, u.avatar_color, u.uid
        FROM hackathon_judges hj JOIN users u ON u.id=hj.user_id WHERE hj.hackathon_id=?
    """, (hid,)) as cur:
        judges = await cur.fetchall()

    async with db.execute("""
        SELECT t.*, u.username as leader_name, u.avatar_color as leader_color, u.uid as leader_uid,
               (SELECT COUNT(*) FROM hackathon_team_members WHERE team_id=t.id) as member_count
        FROM hackathon_teams t JOIN users u ON u.id=t.leader_id WHERE t.hackathon_id=?
    """, (hid,)) as cur:
        teams = await cur.fetchall()

    is_org   = await _is_organizer(hid, current["sub"], db)
    is_judge = await _is_judge(hid, current["sub"], db)

    # Find my team if any
    my_team = None
    async with db.execute("""
        SELECT t.* FROM hackathon_team_members htm
        JOIN hackathon_teams t ON t.id=htm.team_id
        WHERE htm.user_id=? AND t.hackathon_id=?
    """, (current["sub"], hid)) as cur:
        mt = await cur.fetchone()
    if mt:
        my_team = dict(mt)

    return {
        **dict(h),
        "judges": [dict(j) for j in judges],
        "teams": [dict(t) for t in teams],
        "is_organizer": is_org,
        "is_judge": is_judge,
        "my_team": my_team,
    }

@router.post("/{hid}/judges/{uid}")
async def add_judge(hid: str, uid: str, current=Depends(get_current_user), db=Depends(get_db)):
    if not await _is_organizer(hid, current["sub"], db):
        raise HTTPException(status_code=403, detail="Only organizer can add judges")
    target_id = await _uid_to_id(uid, db)
    if not target_id:
        raise HTTPException(status_code=404, detail=f"User with UID {uid} not found")
    try:
        await db.execute("INSERT INTO hackathon_judges (hackathon_id, user_id) VALUES (?,?)", (hid, target_id))
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Already a judge")
    return {"ok": True}

@router.post("/{hid}/teams")
async def create_team(hid: str, body: CreateTeamRequest, current=Depends(get_current_user), db=Depends(get_db)):
    # Check hackathon exists
    async with db.execute("SELECT * FROM hackathons WHERE id=?", (hid,)) as cur:
        h = await cur.fetchone()
    if not h:
        raise HTTPException(status_code=404, detail="Hackathon not found")

    # Check not already in a team
    async with db.execute("""
        SELECT t.id FROM hackathon_team_members htm
        JOIN hackathon_teams t ON t.id=htm.team_id
        WHERE htm.user_id=? AND t.hackathon_id=?
    """, (current["sub"], hid)) as cur:
        if await cur.fetchone():
            raise HTTPException(status_code=400, detail="Already in a team for this hackathon")

    # Check team limit
    async with db.execute("SELECT COUNT(*) as c FROM hackathon_teams WHERE hackathon_id=?", (hid,)) as cur:
        count = (await cur.fetchone())["c"]
    if count >= h["max_teams"]:
        raise HTTPException(status_code=400, detail="Max teams reached")

    # Create isolated private project for this team
    import secrets as sec
    project_id  = str(uuid.uuid4())
    invite_code = sec.token_urlsafe(8)
    await db.execute(
        "INSERT INTO projects (id, name, description, owner_id, invite_code, is_public) VALUES (?,?,?,?,?,0)",
        (project_id, f"[{h['name']}] {body.name}", f"Hackathon team workspace", current["sub"], invite_code)
    )
    await db.execute(
        "INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,'owner')",
        (project_id, current["sub"])
    )

    tid = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO hackathon_teams (id, hackathon_id, name, leader_id, project_id) VALUES (?,?,?,?,?)",
        (tid, hid, body.name, current["sub"], project_id)
    )
    await db.execute(
        "INSERT INTO hackathon_team_members (team_id, user_id, role) VALUES (?,?,'leader')",
        (tid, current["sub"])
    )
    await db.commit()
    return {"id": tid, "name": body.name, "project_id": project_id}

@router.post("/{hid}/teams/{tid}/invite/{uid}")
async def invite_member(hid: str, tid: str, uid: str, current=Depends(get_current_user), db=Depends(get_db)):
    if not await _is_team_leader(tid, current["sub"], db):
        raise HTTPException(status_code=403, detail="Only team leader can invite")

    # Check member limit
    async with db.execute("SELECT max_per_team FROM hackathons WHERE id=?", (hid,)) as cur:
        h = await cur.fetchone()
    async with db.execute("SELECT COUNT(*) as c FROM hackathon_team_members WHERE team_id=?", (tid,)) as cur:
        count = (await cur.fetchone())["c"]
    if count >= h["max_per_team"]:
        raise HTTPException(status_code=400, detail="Team is full")

    target_id = await _uid_to_id(uid, db)
    if not target_id:
        raise HTTPException(status_code=404, detail=f"User with UID {uid} not found")

    try:
        await db.execute(
            "INSERT INTO hackathon_team_members (team_id, user_id, role) VALUES (?,?,'invited')",
            (tid, target_id)
        )
        # NOTE: project access is granted only after the user accepts via /accept endpoint
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="User already in this team")
    return {"ok": True}

@router.post("/{hid}/teams/{tid}/accept")
async def accept_invite(hid: str, tid: str, current=Depends(get_current_user), db=Depends(get_db)):
    # Verify there is actually a pending invite
    async with db.execute(
        "SELECT 1 FROM hackathon_team_members WHERE team_id=? AND user_id=? AND role='invited'",
        (tid, current["sub"])
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="No pending invite found")

    await db.execute(
        "UPDATE hackathon_team_members SET role='member' WHERE team_id=? AND user_id=? AND role='invited'",
        (tid, current["sub"])
    )
    # Now grant project access — only after acceptance
    project_id = await _get_team_project(tid, db)
    if project_id:
        await db.execute(
            "INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)",
            (project_id, current["sub"])
        )
    await db.commit()
    return {"ok": True, "project_id": project_id}

@router.get("/{hid}/teams")
async def list_teams(hid: str, current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("""
        SELECT t.*, u.username as leader_name, u.avatar_color as leader_color
        FROM hackathon_teams t JOIN users u ON u.id=t.leader_id WHERE t.hackathon_id=?
    """, (hid,)) as cur:
        teams = await cur.fetchall()

    result = []
    for team in teams:
        t = dict(team)
        async with db.execute("""
            SELECT u.id, u.username, u.avatar_color, u.uid, htm.role
            FROM hackathon_team_members htm JOIN users u ON u.id=htm.user_id
            WHERE htm.team_id=?
        """, (t["id"],)) as cur:
            members = await cur.fetchall()
        t["members"] = [dict(m) for m in members]
        result.append(t)
    return result

@router.get("/{hid}/judge/overview")
async def judge_overview(hid: str, current=Depends(get_current_user), db=Depends(get_db)):
    """Judges see ALL team workspaces — their messages + files."""
    if not await _is_judge(hid, current["sub"], db) and not await _is_organizer(hid, current["sub"], db):
        raise HTTPException(status_code=403, detail="Judges only")

    async with db.execute("""
        SELECT t.id as team_id, t.name as team_name, t.project_id,
               u.username as leader_name, u.avatar_color as leader_color
        FROM hackathon_teams t JOIN users u ON u.id=t.leader_id WHERE t.hackathon_id=?
    """, (hid,)) as cur:
        teams = await cur.fetchall()

    overview = []
    async with aiosqlite.connect(DB_PATH) as raw_db:
        raw_db.row_factory = aiosqlite.Row
        for team in teams:
            t = dict(team)
            if t["project_id"]:
                async with raw_db.execute(
                    "SELECT * FROM messages WHERE project_id=? ORDER BY created_at DESC LIMIT 50",
                    (t["project_id"],)
                ) as cur:
                    msgs = await cur.fetchall()
                async with raw_db.execute(
                    "SELECT id, filename, language, updated_at FROM workspace_files WHERE project_id=?",
                    (t["project_id"],)
                ) as cur:
                    files = await cur.fetchall()
                t["recent_messages"] = [dict(m) for m in reversed(msgs)]
                t["files"] = [dict(f) for f in files]
            else:
                t["recent_messages"] = []
                t["files"] = []
            overview.append(t)
    return overview

@router.patch("/{hid}/status")
async def update_status(hid: str, body: UpdateStatusRequest, current=Depends(get_current_user), db=Depends(get_db)):
    if not await _is_organizer(hid, current["sub"], db):
        raise HTTPException(status_code=403, detail="Organizer only")
    await db.execute("UPDATE hackathons SET status=? WHERE id=?", (body.status, hid))
    await db.commit()
    return {"ok": True}
