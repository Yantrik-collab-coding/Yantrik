# Hive — Setup Guide

## Quick Start (Local Dev)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your keys
python migrate.py
python run.py
```

### Frontend
```bash
cd frontend
npm install --legacy-peer-deps
cp .env.example .env
# Edit .env with Firebase config
npm start
```

---

## Firebase Setup (Google Sign-In) — 10 minutes

### 1. Create Firebase Project
- Go to console.firebase.google.com
- New Project → name it (e.g. "hive-app")
- Disable Google Analytics (optional)

### 2. Enable Google Auth
- Build → Authentication → Get Started
- Sign-in providers → Google → Enable
- Add your domain to Authorized domains (localhost is already there)

### 3. Get Web App Config (for frontend)
- Project Settings (gear icon) → Your apps → Add app → Web (</>)
- Register app → copy the firebaseConfig object
- Paste values into `frontend/.env`:
  ```
  VITE_FIREBASE_API_KEY=AIza...
  VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=your-project-id
  ...
  ```

### 4. Get Service Account (for backend)
- Project Settings → Service Accounts tab
- Generate new private key → downloads a JSON file
- Move it to `backend/firebase-credentials.json`
- Add to `backend/.env`:
  ```
  FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
  ```

---

## Deployment Checklist

### Before going live:
- [ ] Change JWT_SECRET to a long random string
- [ ] Change ENCRYPTION_SECRET to a long random string
- [ ] Set ALLOWED_ORIGINS to your actual domain
- [ ] Set GROQ_API_KEY
- [ ] Set Firebase credentials
- [ ] Set Razorpay keys (for India payments)
- [ ] Set Stripe keys (for global payments)
- [ ] Switch from SQLite to PostgreSQL (see below)
- [ ] Set up HTTPS

### Switch to PostgreSQL (production):
Replace aiosqlite with asyncpg or use SQLAlchemy async.
Set DATABASE_URL in .env:
```
DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname
```

### Recommended hosting:
- Backend: Railway.app or Render.com (free tier available)
- Frontend: Vercel or Netlify (free)
- Database: Supabase (free PostgreSQL)

---

## All Environment Variables

### Backend (.env)
| Variable | Required | Description |
|---|---|---|
| GROQ_API_KEY | Yes | Free at console.groq.com |
| JWT_SECRET | Yes | Long random string |
| ENCRYPTION_SECRET | Yes | Long random string |
| FIREBASE_CREDENTIALS_PATH | For Google auth | Path to JSON file |
| ALLOWED_ORIGINS | Production | Comma-separated domains |
| RAZORPAY_KEY_ID | For payments (India) | From razorpay.com |
| RAZORPAY_KEY_SECRET | For payments (India) | From razorpay.com |
| STRIPE_SECRET_KEY | For payments (global) | From stripe.com |
| STRIPE_PUBLISHABLE_KEY | For payments (global) | From stripe.com |
| STRIPE_WEBHOOK_SECRET | For payments (global) | From Stripe webhook |
| STRIPE_PRICE_BYOK | For payments (global) | Stripe price ID |
| STRIPE_PRICE_OLLAMA | For payments (global) | Stripe price ID |
| FRONTEND_URL | For Stripe redirect | Your frontend URL |

### Frontend (.env)
| Variable | Required | Description |
|---|---|---|
| VITE_FIREBASE_API_KEY | For Google auth | From Firebase console |
| VITE_FIREBASE_AUTH_DOMAIN | For Google auth | From Firebase console |
| VITE_FIREBASE_PROJECT_ID | For Google auth | From Firebase console |
| VITE_FIREBASE_STORAGE_BUCKET | For Google auth | From Firebase console |
| VITE_FIREBASE_MESSAGING_SENDER_ID | For Google auth | From Firebase console |
| VITE_FIREBASE_APP_ID | For Google auth | From Firebase console |
