# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Yantrik** is a collaborative AI coding platform for teams. It's a desktop application (Electron) with a FastAPI backend and React frontend. The app supports AI-powered coding with multiple LLM providers (Groq, OpenAI, Anthropic, Google, Ollama) and includes features like project collaboration, hackathons, forums, and billing.

## Architecture

### Three-Tier Structure

```
final-project/
├── backend/          # FastAPI Python backend (port 8000)
│   ├── main.py       # Entry point with all routers mounted under /api
│   ├── core/         # Database, auth, encryption, LLM routing, agent executor
│   └── routers/      # auth, projects, chat, files, billing, forum, friends, hackathon
├── frontend/         # React + TypeScript + Vite (port 3000)
│   ├── src/pages/    # Route components
│   ├── src/components/ui/  # shadcn/ui components
│   └── src/lib/      # API client, store (Zustand), Firebase config
└── electron/         # Desktop shell with PTY support
    ├── main.js       # Spawns FastAPI, manages window, PTY sessions
    └── preload.js    # Exposes window.electronAPI for terminal IPC
```

### Key Technical Decisions

- **Database**: SQLite via aiosqlite (async). Schema created in `core/database.py`.
- **Auth**: JWT tokens (stored in localStorage) + optional Firebase Google Sign-In.
- **State Management**: Zustand for auth; React Query for server state.
- **Styling**: Tailwind CSS + shadcn/ui components.
- **Terminal**: node-pty in Electron for real PTY; run-output fallback in browser.
- **LLM Routing**: `core/llm.py` routes to different providers based on model tier (free/BYOK/ollama).

## Development Commands

All commands run from `final-project/` directory.

### Setup (First Time)

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with GROQ_API_KEY, JWT_SECRET, ENCRYPTION_SECRET
python migrate.py

# Frontend
cd ../frontend
npm install --legacy-peer-deps
cp .env.example .env
# Edit .env with Firebase config
```

### Development

```bash
# Option 1: Web only (backend + frontend)
cd backend && python run.py          # Terminal 1
cd frontend && npm run dev           # Terminal 2

# Option 2: Desktop app (Electron + backend + frontend)
npm install                            # Root package.json (once)
npm run dev                            # Starts Vite + Electron concurrently
```

### Building

```bash
# Production build (Electron app)
npm run build                          # Builds frontend, then packages Electron
# Output: dist-electron/ (installer for current platform)

# Build just frontend
cd frontend && npm run build
```

### Testing & Linting

```bash
cd frontend
npm run test                           # Run Vitest tests once
npm run test:watch                     # Run tests in watch mode
npm run lint                           # ESLint
```

### Running Single Tests

```bash
cd frontend
npx vitest run src/test/example.test.ts    # Run specific test file
npx vitest run --reporter=verbose          # Verbose output
```

## Environment Variables

### Backend (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| GROQ_API_KEY | Yes | From console.groq.com |
| JWT_SECRET | Yes | Long random string for token signing |
| ENCRYPTION_SECRET | Yes | Long random string for API key encryption |
| FIREBASE_CREDENTIALS_PATH | For Google auth | Path to JSON file |
| DATABASE_URL | Optional | Defaults to SQLite (hive.db) |

### Frontend (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| VITE_FIREBASE_API_KEY | For Google auth | From Firebase console |
| VITE_FIREBASE_AUTH_DOMAIN | For Google auth | From Firebase console |

## Code Patterns

### Adding API Endpoints

Backend routes are organized by feature in `backend/routers/`. All routers are mounted in `main.py` with `/api` prefix:

```python
# main.py
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
```

Frontend API calls use the centralized `lib/api.ts` (axios instance with auth header):

```typescript
import api from '@/lib/api'
const response = await api.get('/projects')  // Automatically adds /api prefix via proxy
```

### Database Queries

Use the `get_db()` async context manager:

```python
from core.database import get_db

async def get_user(user_id: str):
    async for db in get_db():
        row = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return await row.fetchone()
```

### Authentication

- Backend: JWT middleware in `core/auth.py`, apply with `Depends(get_current_user)`
- Frontend: Token stored in localStorage via Zustand store; automatically attached to API calls

### Terminal (Electron)

The Terminal component auto-detects Electron and uses real PTY via IPC:

```typescript
if (window.electronAPI?.isDesktop) {
  // Real PTY via node-pty
  window.electronAPI.ptyCreate(projectId, cwd)
  window.electronAPI.onPtyData(projectId, (data) => term.write(data))
} else {
  // Browser: show run output fallback
}
```

## Important File Locations

| Purpose | Path |
|---------|------|
| Main backend entry | `backend/main.py` |
| Database schema | `backend/core/database.py` |
| LLM provider routing | `backend/core/llm.py` |
| Agent execution | `backend/core/agent_executor.py` |
| Frontend entry | `frontend/src/main.tsx` |
| Auth store | `frontend/src/lib/store.ts` |
| API client | `frontend/src/lib/api.ts` |
| Electron main | `electron/main.js` |
| Terminal component | `frontend/src/components/Terminal.tsx` |

## Router Structure (Frontend)

Defined in `App.tsx`:
- `/auth` - Login/signup
- `/` - Dashboard (project list)
- `/project/:id` - IDE with code editor, chat, terminal
- `/profile` - User settings, API keys
- `/forum` - Public project sharing
- `/hackathon` - Hackathon listings
- `/pricing` - Subscription plans

## Common Issues

- **Windows node-pty build failures**: Run `npm install --global windows-build-tools` first
- **Backend not starting**: Check Python 3.12+ and that `backend/venv` exists
- **Blank screen in Electron**: Ensure `import 'xterm/css/xterm.css'` in main.tsx
- **CORS errors**: Frontend proxies `/api` to `localhost:8000` in dev (see `vite.config.ts`)
