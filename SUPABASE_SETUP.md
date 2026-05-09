# Supabase Auth Setup Guide

This guide walks you through setting up Supabase Auth to replace Firebase, with **email confirmation** and **Google OAuth** support.

---

## Step 1: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign up/login
2. Click **"New Project"**
3. Enter your project name and set a database password
4. Choose a region close to your users
5. Click **"Create new project"** (takes 1-2 minutes)

---

## Step 2: Get Your API Keys

1. In your Supabase dashboard, go to **Project Settings** (gear icon)
2. Click **"API"** in the left sidebar
3. Copy the following values:
   - **URL** (e.g., `https://abcdefgh12345678.supabase.co`)
   - **anon public** key (starts with `eyJhbGci...`)
   - **service_role secret** key (keep this secret!)

---

## Step 3: Configure Frontend Environment

Create `frontend/.env` file:

```bash
cd frontend
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Step 4: Configure Backend Environment

Create `backend/.env` file:

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```env
JWT_SECRET=your-super-secret-jwt-key-change-this
ENCRYPTION_SECRET=another-secret-for-encryption
DB_PATH=hive.db

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Y3ZzbHl5aXhmcW13aWdid2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk1NjYyNCwiZXhwIjoyMDkwNTMyNjI0fQ.3V_l6C85ie37AKgbtEsHabAnkbkmgHb-zFTmkOlpCsU

ALLOWED_ORIGINS=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

---

## Step 5: Enable Email Auth with Confirmation

### Configure Email Provider

1. In Supabase dashboard, go to **Authentication → Providers**
2. Find **Email** and make sure it's enabled
3. Click on **Email** to configure:
   - **Confirm email**: ✓ Enable (checked)
   - **Secure email change**: ✓ Enable (checked)
   - **Mailer**: Use the default or configure your own SMTP

### Customize Confirmation Email (Optional)

1. Go to **Authentication → Email Templates**
2. Edit the **Confirm signup** template
3. The default template sends a link like: `{{ .ConfirmationURL }}`
4. This redirects back to your app automatically

---

---

## Step 6: Install Dependencies & Run

### Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
# or: source venv/bin/activate  # Mac/Linux

pip install -r requirements.txt
python migrate.py  # Adds new supabase_uid column
python run.py
```

### Frontend Setup

```bash
cd frontend
npm install --legacy-peer-deps  # Installs @supabase/supabase-js
npm run dev
```

### Run Desktop App (Electron)

```bash
cd final-project
npm install
npm run dev
```

---

## How It Works

### Email/Password Sign Up Flow

1. User fills out signup form (email, password, username)
2. Frontend calls `supabase.auth.signUp()`
3. Supabase sends confirmation email to user
4. User clicks confirmation link in email
5. User is redirected back to the app
6. User can now sign in with email/password

### Password Reset Flow

1. User clicks "Forgot password?"
2. Frontend calls `supabase.auth.resetPasswordForEmail()`
3. Supabase sends reset email
4. User clicks link and enters new password
5. Password is updated in Supabase
6. User can sign in with new password

---

## Troubleshooting

### "Email not confirmed" Error

- User needs to check email inbox and click confirmation link
- Check spam folder
- Can resend confirmation from the UI

### Google Auth Not Working

1. Check Google Cloud Console redirect URIs match exactly
2. Ensure Supabase URL is in authorized JavaScript origins
3. Verify Client ID and Secret are correct in Supabase

### "Invalid Supabase token" Error

- Check `SUPABASE_SERVICE_KEY` is set correctly in backend `.env`
- Service role key is different from anon key!

### Migration Issues

If you have existing users:
- Old Firebase users will need to re-create accounts or you can migrate data
- Run `python migrate.py` to add the new `supabase_uid` column

---

## Database Schema Changes

The migration adds a `supabase_uid` column to track Supabase user IDs:

```sql
ALTER TABLE users ADD COLUMN supabase_uid TEXT UNIQUE;
```

This allows linking between your local user records and Supabase Auth users.

---

## Security Notes

- **Never commit** `.env` files with real credentials
- Keep `SUPABASE_SERVICE_KEY` secret (backend only)
- Use `VITE_SUPABASE_ANON_KEY` on frontend (safe for public)
- Enable Row Level Security (RLS) in Supabase if using Supabase database
- Always use HTTPS in production

---

## Next Steps

After setup is working:
1. Test email signup with confirmation
2. Test Google OAuth
3. Test password reset
4. Configure production domains in Supabase
5. Set up custom SMTP for production emails (SendGrid, AWS SES, etc.)
