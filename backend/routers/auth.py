from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.database import get_db
from core.auth import hash_password, verify_password, create_token, get_current_user
import uuid, random, secrets, string

router = APIRouter()
COLORS = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#8b5cf6","#ef4444","#14b8a6"]

def _gen_uid():
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(8))

def _validate_email(email: str) -> bool:
    import re
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email))

class SignupRequest(BaseModel):
    email: str
    username: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class GoogleAuthRequest(BaseModel):
    id_token: str

@router.post("/signup")
async def signup(body: SignupRequest, db=Depends(get_db)):
    # Validate inputs
    if not _validate_email(body.email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if len(body.username) < 2 or len(body.username) > 30:
        raise HTTPException(status_code=400, detail="Username must be 2-30 characters")
    if not body.username.replace('_','').replace('-','').isalnum():
        raise HTTPException(status_code=400, detail="Username can only contain letters, numbers, _ and -")

    user_id = str(uuid.uuid4())
    color   = random.choice(COLORS)
    uid     = _gen_uid()
    try:
        await db.execute(
            "INSERT INTO users (id, email, username, password_hash, avatar_color, uid) VALUES (?,?,?,?,?,?)",
            (user_id, body.email.lower().strip(), body.username, hash_password(body.password), color, uid)
        )
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Email or username already taken")
    token = create_token(user_id, body.email)
    return {"token": token, "user": {"id": user_id, "email": body.email, "username": body.username, "avatar_color": color, "uid": uid}}

@router.post("/login")
async def login(body: LoginRequest, db=Depends(get_db)):
    async with db.execute("SELECT * FROM users WHERE email=?", (body.email.lower().strip(),)) as cur:
        user = await cur.fetchone()
    if not user or not user["password_hash"] or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["email"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "username": user["username"], "avatar_color": user["avatar_color"], "uid": user["uid"]}}

@router.post("/google")
async def google_signin(body: GoogleAuthRequest, db=Depends(get_db)):
    """Verify Firebase ID token → sign in or create account."""
    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth
        if not firebase_admin._apps:
            raise HTTPException(status_code=503, detail="Google Sign-In not configured on server")
        decoded = firebase_auth.verify_id_token(body.id_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")

    google_uid = decoded["uid"]
    email      = decoded.get("email", "").lower().strip()
    name       = decoded.get("name", email.split("@")[0])
    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    # Check existing user by google_id or email
    async with db.execute("SELECT * FROM users WHERE google_id=? OR email=?", (google_uid, email)) as cur:
        user = await cur.fetchone()

    if user:
        if not user["google_id"]:
            await db.execute("UPDATE users SET google_id=? WHERE id=?", (google_uid, user["id"]))
            await db.commit()
        token = create_token(user["id"], email)
        return {"token": token, "user": {"id": user["id"], "email": email, "username": user["username"], "avatar_color": user["avatar_color"], "uid": user["uid"]}}

    # New user — create account
    user_id = str(uuid.uuid4())
    uid     = _gen_uid()
    color   = random.choice(COLORS)
    # Unique username from display name
    base = ''.join(c for c in name.lower().replace(' ', '_') if c.isalnum() or c == '_')[:20] or 'user'
    username, suffix = base, 1
    while True:
        async with db.execute("SELECT id FROM users WHERE username=?", (username,)) as cur:
            if not await cur.fetchone(): break
        username = f"{base}{suffix}"; suffix += 1

    await db.execute(
        "INSERT INTO users (id, email, username, password_hash, avatar_color, uid, google_id) VALUES (?,?,?,?,?,?,?)",
        (user_id, email, username, "", color, uid, google_uid)
    )
    await db.commit()
    token = create_token(user_id, email)
    return {"token": token, "user": {"id": user_id, "email": email, "username": username, "avatar_color": color, "uid": uid}}

@router.get("/me")
async def me(current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM users WHERE id=?", (current["sub"],)) as cur:
        user = await cur.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user["id"], "email": user["email"], "username": user["username"], "avatar_color": user["avatar_color"], "uid": user["uid"]}

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM users WHERE id=?", (current["sub"],)) as cur:
        user = await cur.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["password_hash"] and not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    await db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(body.new_password), current["sub"]))
    await db.commit()
    return {"ok": True}

class AvatarColorRequest(BaseModel):
    color: str

@router.patch("/avatar-color")
async def update_avatar_color(body: AvatarColorRequest, current=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("UPDATE users SET avatar_color=? WHERE id=?", (body.color, current["sub"]))
    await db.commit()
    return {"ok": True, "color": body.color}

class UpdateUsernameRequest(BaseModel):
    username: str

@router.patch("/username")
async def update_username(body: UpdateUsernameRequest, current=Depends(get_current_user), db=Depends(get_db)):
    if len(body.username) < 2 or len(body.username) > 30:
        raise HTTPException(status_code=400, detail="Username must be 2-30 characters")
    try:
        await db.execute("UPDATE users SET username=? WHERE id=?", (body.username, current["sub"]))
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Username already taken")
    return {"ok": True}
