"""
routers/friends.py
GET  /friends/             → list my friends
GET  /friends/requests     → pending incoming requests
POST /friends/add/{uid}    → send friend request by UID
POST /friends/accept/{uid} → accept request
POST /friends/reject/{uid} → reject request
DELETE /friends/{uid}      → remove friend
GET  /friends/search/{uid} → look up user by UID
"""
from fastapi import APIRouter, HTTPException, Depends
from core.database import get_db
from core.auth import get_current_user

router = APIRouter()

async def _uid_to_user(uid: str, db):
    async with db.execute("SELECT id, username, avatar_color, uid FROM users WHERE uid=?", (uid,)) as cur:
        return await cur.fetchone()

@router.get("/search/{uid}")
async def search_by_uid(uid: str, db=Depends(get_db)):
    row = await _uid_to_user(uid.upper(), db)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": row["id"], "username": row["username"], "avatar_color": row["avatar_color"], "uid": row["uid"]}

@router.get("/")
async def list_friends(current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("""
        SELECT u.id, u.username, u.avatar_color, u.uid, f.created_at
        FROM friends f
        JOIN users u ON u.id = CASE WHEN f.sender_id=? THEN f.receiver_id ELSE f.sender_id END
        WHERE (f.sender_id=? OR f.receiver_id=?) AND f.status='accepted'
    """, (current["sub"], current["sub"], current["sub"])) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.get("/requests")
async def list_requests(current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("""
        SELECT f.id, f.sender_id, u.username, u.avatar_color, u.uid, f.created_at
        FROM friends f JOIN users u ON u.id=f.sender_id
        WHERE f.receiver_id=? AND f.status='pending'
        ORDER BY f.created_at DESC
    """, (current["sub"],)) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]

@router.post("/add/{uid}")
async def add_friend(uid: str, current=Depends(get_current_user), db=Depends(get_db)):
    target = await _uid_to_user(uid.upper(), db)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == current["sub"]:
        raise HTTPException(status_code=400, detail="Can't add yourself")
    import uuid
    try:
        await db.execute(
            "INSERT INTO friends (id, sender_id, receiver_id) VALUES (?,?,?)",
            (str(uuid.uuid4()), current["sub"], target["id"])
        )
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Request already sent or already friends")
    return {"ok": True, "message": f"Friend request sent to {target['username']}"}

@router.post("/accept/{uid}")
async def accept_friend(uid: str, current=Depends(get_current_user), db=Depends(get_db)):
    target = await _uid_to_user(uid.upper(), db)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.execute(
        "UPDATE friends SET status='accepted' WHERE sender_id=? AND receiver_id=? AND status='pending'",
        (target["id"], current["sub"])
    )
    await db.commit()
    return {"ok": True}

@router.post("/reject/{uid}")
async def reject_friend(uid: str, current=Depends(get_current_user), db=Depends(get_db)):
    target = await _uid_to_user(uid.upper(), db)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.execute(
        "UPDATE friends SET status='rejected' WHERE sender_id=? AND receiver_id=?",
        (target["id"], current["sub"])
    )
    await db.commit()
    return {"ok": True}

@router.delete("/{uid}")
async def remove_friend(uid: str, current=Depends(get_current_user), db=Depends(get_db)):
    target = await _uid_to_user(uid.upper(), db)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.execute(
        "DELETE FROM friends WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)",
        (current["sub"], target["id"], target["id"], current["sub"])
    )
    await db.commit()
    return {"ok": True}
