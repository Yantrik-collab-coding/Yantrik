from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.database import get_db
from core.auth import hash_password, verify_password, create_token, get_current_user
import uuid, random, secrets, string, os

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

class SupabaseAuthRequest(BaseModel):
    access_token: str
    email: str
    username: str | None = None

def verify_supabase_token(access_token: str) -> dict:
    """Verify a Supabase JWT token and return user data."""
    import jwt
    import httpx

    try:
        # Decode without verification first to get the issuer
        unverified = jwt.decode(access_token, options={"verify_signature": False})

        # Get the Supabase URL from env
        supabase_url = os.getenv("SUPABASE_URL", "")
        if not supabase_url:
            raise HTTPException(status_code=503, detail="Supabase not configured on server")

        # Verify the token by fetching user from Supabase
        headers = {
            "Authorization": f"Bearer {access_token}",
            "apikey": os.getenv("SUPABASE_SERVICE_KEY", "")
        }

        response = httpx.get(
            f"{supabase_url}/auth/v1/user",
            headers=headers,
            timeout=10.0
        )

        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired Supabase token")

        user_data = response.json()

        # Verify email is confirmed
        if not user_data.get("email_confirmed_at") and not user_data.get("confirmed_at"):
            raise HTTPException(status_code=401, detail="Email not confirmed. Please check your inbox.")

        return user_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")

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

@router.get("/me")
async def me(current=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM users WHERE id=?", (current["sub"],)) as cur:
        user = await cur.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user["id"], "email": user["email"], "username": user["username"], "avatar_color": user["avatar_color"], "uid": user["uid"]}

@router.post("/supabase")
async def supabase_auth(body: SupabaseAuthRequest, db=Depends(get_db)):
    """Verify Supabase token and create/get user in local database."""
    # Verify the Supabase token
    user_data = verify_supabase_token(body.access_token)

    email = user_data.get("email", "").lower().strip()
    supabase_uid = user_data.get("id", "")

    if not email:
        raise HTTPException(status_code=400, detail="User has no email")

    # Get user metadata
    user_metadata = user_data.get("user_metadata", {})
    name = user_metadata.get("full_name") or user_metadata.get("name") or email.split("@")[0]
    provider = user_data.get("app_metadata", {}).get("provider", "")

    # Check existing user by supabase_uid or email
    async with db.execute("SELECT * FROM users WHERE supabase_uid=? OR email=?", (supabase_uid, email)) as cur:
        user = await cur.fetchone()

    if user:
        # Update supabase_uid if not set
        if not user["supabase_uid"]:
            await db.execute("UPDATE users SET supabase_uid=? WHERE id=?", (supabase_uid, user["id"]))
            await db.commit()

        token = create_token(user["id"], email)
        return {
            "token": token,
            "user": {
                "id": user["id"],
                "email": email,
                "username": user["username"],
                "avatar_color": user["avatar_color"],
                "uid": user["uid"]
            }
        }

    # New user - create account
    user_id = str(uuid.uuid4())
    uid = _gen_uid()
    color = random.choice(COLORS)

    # Unique username from display name
    base = ''.join(c for c in name.lower().replace(' ', '_') if c.isalnum() or c == '_')[:20] or 'user'
    username, suffix = base, 1
    while True:
        async with db.execute("SELECT id FROM users WHERE username=?", (username,)) as cur:
            if not await cur.fetchone():
                break
        username = f"{base}{suffix}"
        suffix += 1

    await db.execute(
        "INSERT INTO users (id, email, username, password_hash, avatar_color, uid, supabase_uid) VALUES (?,?,?,?,?,?,?)",
        (user_id, email, username, "", color, uid, supabase_uid)
    )
    await db.commit()

    token = create_token(user_id, email)
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "username": username,
            "avatar_color": color,
            "uid": uid
        }
    }

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
