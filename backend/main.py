import os
import json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from routers import auth, projects, chat
from routers.files import router as files_router
from routers.billing import router as billing_router
from routers.forum import router as forum_router
from routers.friends import router as friends_router
from routers.hackathon import router as hackathon_router
from core.database import init_db

app = FastAPI(title="Yantrik API", version="1.0.0")

# ── Firebase Admin SDK ────────────────────────────────────────────────────────
try:
    import firebase_admin
    from firebase_admin import credentials as fb_creds
    if not firebase_admin._apps:
        cred_json = os.getenv("FIREBASE_CREDENTIALS_JSON", "")
        cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "")
        if cred_json:
            cred_dict = json.loads(cred_json)
            firebase_admin.initialize_app(fb_creds.Certificate(cred_dict))
            print("Firebase initialized from FIREBASE_CREDENTIALS_JSON env var")
        elif cred_path and os.path.exists(cred_path):
            firebase_admin.initialize_app(fb_creds.Certificate(cred_path))
            print("Firebase initialized from credentials file")
        elif os.getenv("FIREBASE_PROJECT_ID"):
            firebase_admin.initialize_app()
            print("Firebase initialized from environment")
        else:
            print("Firebase not configured - Google Sign-In disabled")
except ImportError:
    print("firebase-admin not installed - Google Sign-In disabled")
except Exception as e:
    print(f"Firebase initialization failed: {e} - Google Sign-In disabled")

# ── Rate limiting ─────────────────────────────────────────────────────────────
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware
    limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
except ImportError:
    print("slowapi not installed - rate limiting disabled")

# ── CORS ──────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
).split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback; traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

@app.on_event("startup")
async def startup():
    await init_db()
    if os.getenv("JWT_SECRET", "hive-secret-change-in-prod") == "hive-secret-change-in-prod":
        print("⚠️  WARNING: JWT_SECRET is using the default value.")
    if os.getenv("ENCRYPTION_SECRET", "hive-default-change-in-prod-please") == "hive-default-change-in-prod-please":
        print("⚠️  WARNING: ENCRYPTION_SECRET is using the default value.")

# ── API Routers (all under /api prefix to match frontend) ────────────────────
app.include_router(auth.router,         prefix="/api/auth",       tags=["auth"])
app.include_router(projects.router,     prefix="/api/projects",   tags=["projects"])
app.include_router(chat.router,         prefix="/api/chat",       tags=["chat"])
app.include_router(files_router,        prefix="/api/projects",   tags=["files"])
app.include_router(billing_router,      prefix="/api/billing",    tags=["billing"])
app.include_router(forum_router,        prefix="/api/forum",      tags=["forum"])
app.include_router(friends_router,      prefix="/api/friends",    tags=["friends"])
app.include_router(hackathon_router,    prefix="/api/hackathons", tags=["hackathons"])

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}

# ── Serve React frontend (must be LAST) ───────────────────────────────────────
DIST_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Never intercept API routes
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(os.path.join(DIST_DIR, "index.html"))

    print(f"Serving frontend from {DIST_DIR}")
else:
    print("Frontend dist not found - API only mode")