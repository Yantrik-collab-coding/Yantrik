# Yantrik — Collaborative AI Coding Workspace

> **YANTRIK** — *automated, mechanical* · A shared IDE where your team and an AI agent write code together, in real time.

**🎉 Free for everyone until September 20, 2026 — no payment required.**

---

## What is Yantrik?

Yantrik is an open-source, real-time collaborative IDE with a built-in AI coding agent. Multiple developers share a project workspace, chat in real time, and invoke the AI agent to plan and execute code changes — which are shown as reviewable diffs before anything is actually written.

Think of it as: **Google Docs × GitHub Copilot × your whole team, in one tab.**

---

## Key Features

**Real-time collaboration**
Every team member joins the same project room. Chat, file changes, and agent activity are broadcast live over WebSockets.

**AI agent with plan → execute flow**
Type `@agent` in the chat to invoke the agent. It generates a structured plan, then executes each step one at a time — creating or modifying files. Every code change is staged as a diff for human review before it touches your workspace.

```
@agent create a FastAPI health endpoint in main.py
@agent refactor auth.py to use JWT refresh tokens
@agent explain how the diff engine works
```

**Bring Your Own Key (BYOK)**
Yantrik never charges for model usage. You bring your own API key (Groq, OpenAI, Anthropic, Google) — keys are AES-256 encrypted at rest and never logged.

**Local models via Ollama**
Point Yantrik at your local Ollama instance and run fully private inference with no API costs.

**Multi-provider model support**

| Tier | Models |
|------|--------|
| Free (Groq) | Llama 3.3 70B, Llama 3.1 8B, Mixtral 8x7B, Gemma 2 9B |
| BYOK | GPT-4o, Claude Opus/Sonnet/Haiku, Gemini 1.5 Pro/Flash |
| Ollama | Any local model — Llama 3, Mistral, CodeLlama, custom |

Each team member picks their own model — your teammate can use GPT-4o while you use Claude.

**Community features**
- Open Forum — showcase public projects
- Hackathons — host and join coding competitions
- Friends system — follow other developers

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12, FastAPI, aiosqlite, WebSockets |
| Frontend | React 18, TypeScript, Vite, Monaco Editor, Zustand |
| Auth | JWT + Firebase (Google Sign-In) |
| LLMs | Groq, OpenAI, Anthropic, Google Gemini, Ollama |
| Payments | Razorpay (India) · Stripe (Global) |
| DB | SQLite (dev) · PostgreSQL (prod) |

---

## Getting Started (Local Dev)

### Prerequisites
- Python 3.11+
- Node.js 18+
- A free [Groq API key](https://console.groq.com/keys) (for the AI agent)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and ENCRYPTION_SECRET
python migrate.py
python run.py
# → http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
cp .env.example .env
# Edit .env with your Firebase config (see Firebase Setup below)
npm run dev
# → http://localhost:5173
```

### First run
1. Open `http://localhost:5173` and create an account
2. Go to **Profile → API Keys** and add your Groq key (free at console.groq.com)
3. Create a project and invite teammates via the invite code
4. Type `@agent create a hello world in main.py` in the chat

---

## Firebase Setup (Google Sign-In — optional)

Email/password auth works without Firebase. To enable Google Sign-In:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → New Project
2. **Build → Authentication → Get Started → Google → Enable**
3. **Project Settings → Your apps → Add Web App** → copy the `firebaseConfig`
4. Paste values into `frontend/.env`
5. **Project Settings → Service Accounts → Generate new private key** → save as `backend/firebase-credentials.json`
6. Add `FIREBASE_CREDENTIALS_PATH=firebase-credentials.json` to `backend/.env`

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | Long random string — change before deploying |
| `ENCRYPTION_SECRET` | ✅ | Long random string — used to encrypt stored API keys |
| `LAUNCH_DATE` | — | ISO date of go-live (e.g. `2026-03-20`) |
| `FREE_UNTIL` | — | ISO date when free window ends (e.g. `2026-09-20`) |
| `FIREBASE_CREDENTIALS_PATH` | Google auth | Path to Firebase service account JSON |
| `ALLOWED_ORIGINS` | Production | Comma-separated allowed frontend domains |
| `RAZORPAY_KEY_ID` | Payments (India) | From razorpay.com |
| `RAZORPAY_KEY_SECRET` | Payments (India) | From razorpay.com |
| `STRIPE_SECRET_KEY` | Payments (global) | From stripe.com |
| `STRIPE_PUBLISHABLE_KEY` | Payments (global) | From stripe.com |
| `STRIPE_WEBHOOK_SECRET` | Payments (global) | From Stripe webhook settings |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Google auth | From Firebase console |
| `VITE_FIREBASE_AUTH_DOMAIN` | Google auth | From Firebase console |
| `VITE_FIREBASE_PROJECT_ID` | Google auth | From Firebase console |
| `VITE_FIREBASE_STORAGE_BUCKET` | Google auth | From Firebase console |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Google auth | From Firebase console |
| `VITE_FIREBASE_APP_ID` | Google auth | From Firebase console |

---

## Deployment

### Recommended stack (free tiers available)

| Service | Provider | Notes |
|---------|----------|-------|
| Backend | [Railway.app](https://railway.app) or [Render.com](https://render.com) | Set all env vars in dashboard |
| Frontend | [Vercel](https://vercel.com) | Connect GitHub repo, auto-deploy |
| Database | [Supabase](https://supabase.com) | Free PostgreSQL — replace SQLite for production |

### Pre-deployment checklist

- [ ] Set `JWT_SECRET` to a strong random string (at least 64 chars)
- [ ] Set `ENCRYPTION_SECRET` to a strong random string (at least 32 chars)
- [ ] Set `ALLOWED_ORIGINS` to your frontend domain
- [ ] Set `LAUNCH_DATE` and `FREE_UNTIL`
- [ ] Configure Firebase for Google auth
- [ ] Switch `DB_PATH` to a PostgreSQL URL for production
- [ ] Set up HTTPS (handled automatically by Railway/Vercel)

---

## How the AI Agent Works

```
User types: @agent add input validation to register endpoint

1. generate_plan()
   LLM produces a JSON plan:
   {
     "goal": "Add input validation to /register",
     "steps": [
       { "action": "modify_file", "target_file": "auth.py",
         "instruction": "Add email format and password length validation" }
     ]
   }

2. execute_plan()
   For each step:
   - Reads current file content
   - LLM generates the complete updated file
   - Python files: syntax check → auto-correct if needed
   - Generates a unified diff
   - Stores as pending_diff (not yet applied)

3. Review
   Team sees the diff in the Files panel
   Accept → file is updated for everyone
   Reject → change is discarded
```

The agent never writes directly to files. Every change is a reviewable diff.

---

## Project Structure

```
yantrik/
├── backend/
│   ├── core/
│   │   ├── agent_executor.py   # Plan → Execute engine
│   │   ├── auth.py             # JWT + password hashing
│   │   ├── database.py         # SQLite schema + init
│   │   ├── diff_engine.py      # Unified diff + risk scoring
│   │   ├── encryption.py       # AES-256 for stored API keys
│   │   ├── launch.py           # Free window logic
│   │   ├── llm.py              # Multi-provider LLM router
│   │   └── models.py           # Model registry
│   ├── routers/
│   │   ├── auth.py             # Signup, login, Google OAuth
│   │   ├── billing.py          # Razorpay, Stripe, API key mgmt
│   │   ├── chat.py             # WebSocket + agent orchestration
│   │   ├── files.py            # Workspace file CRUD
│   │   ├── forum.py            # Public project showcase
│   │   ├── friends.py          # Friend system
│   │   ├── hackathon.py        # Hackathon listings
│   │   └── projects.py         # Project + member management
│   ├── main.py                 # FastAPI app + middleware
│   ├── migrate.py              # DB migration runner
│   └── requirements.txt
└── frontend/
    └── src/
        ├── components/
        │   ├── AgentSteps.tsx  # Live step-by-step agent UI
        │   └── DiffViewer.tsx  # Side-by-side diff review
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── ProjectPage.tsx # Main IDE workspace
        │   ├── ProfilePage.tsx # API keys + billing
        │   ├── ForumPage.tsx
        │   ├── HackathonPage.tsx
        │   └── PricingPage.tsx
        └── lib/
            ├── api.ts          # Axios client
            ├── firebase.ts     # Firebase init
            └── store.ts        # Zustand auth store
```

---

## Contributing

Contributions are welcome. Please open an issue before submitting a large PR so we can discuss direction.

```bash
# Fork → clone → create branch
git checkout -b feature/your-feature

# Make changes, test locally
# Submit PR against main
```

Areas we'd love help with:
- More language support in the diff engine (currently strong on Python)
- VS Code extension
- Mobile-responsive layout
- More Ollama model presets
- i18n / localization

---

## Pricing

Yantrik is free to self-host forever.

The hosted version at [yantrik.app](https://yantrik.app) is **fully free until September 20, 2026**. After that:

| Plan | India | Global | Unlocks |
|------|-------|--------|---------|
| Free | ₹0/mo | $0/mo | Groq models (Llama, Mixtral, Gemma) |
| BYOK | ₹25/mo | $2/mo | OpenAI, Anthropic, Google models |
| Ollama | ₹35/mo | $3/mo | Local Ollama models |

We never charge for model usage — you pay your API provider directly.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgements

Built with [FastAPI](https://fastapi.tiangolo.com), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [Groq](https://groq.com), and [Ollama](https://ollama.ai).

---

<p align="center">Made with ❤️ · <a href="https://yantrik.app">yantrik.app</a></p>
