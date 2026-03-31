import os
import json

# Load .env file if python-dotenv is installed
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("Loaded .env file")
except ImportError:
    print("python-dotenv not installed, using system environment variables")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from routers import auth, projects, chat
from routers.files import router as files_router
from routers.billing import router as billing_router
from routers.forum import router as forum_router
from routers.friends import router as friends_router
from routers.hackathon import router as hackathon_router
from core.database import init_db

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"
        # XSS protection
        response.headers["X-XSS-Protection"] = "1; mode=block"
        # Referrer policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app = FastAPI(title="Yantrik API", version="1.0.0")

# -- CORS (MUST be first to handle preflight OPTIONS requests) --
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:8000"
).split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- Security Headers (after CORS) --
app.add_middleware(SecurityHeadersMiddleware)

# -- Supabase Configuration Check --
if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_KEY"):
    print("WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not configured.")
    print("         Authentication features may not work properly.")
else:
    print("Supabase configuration detected.")

# -- Rate limiting (after CORS) --
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

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback; traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

@app.on_event("startup")
async def startup():
    await init_db()
    if os.getenv("JWT_SECRET", "yantrik-secret-change-in-prod") == "yantrik-secret-change-in-prod":
        print("WARNING: JWT_SECRET is using the default value.")
    if os.getenv("ENCRYPTION_SECRET", "yantrik-default-change-in-prod-please") == "yantrik-default-change-in-prod-please":
        print("WARNING: ENCRYPTION_SECRET is using the default value.")

# -- API Routers (all under /api prefix to match frontend) --
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

# -- Serve React frontend (must be LAST) --
# Try multiple possible locations for the frontend (dev vs production)
POSSIBLE_DIST_DIRS = [
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"),
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"),
    os.path.join(os.path.dirname(__file__), "frontend", "dist"),
]

DIST_DIR = None
for dist_path in POSSIBLE_DIST_DIRS:
    if os.path.exists(dist_path) and os.path.exists(os.path.join(dist_path, "index.html")):
        DIST_DIR = dist_path
        break

if DIST_DIR:
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(os.path.join(DIST_DIR, "index.html"))

    print(f"Serving frontend from {DIST_DIR}")
else:
    print("Frontend dist not found - API only mode")
    print(f"Searched paths: {POSSIBLE_DIST_DIRS}")
