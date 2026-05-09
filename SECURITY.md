# Security Guide for Yantrik

This document outlines security considerations for deploying Yantrik.

## 🔐 Environment Security

### Required Environment Variables

Before deploying, set these secure values:

| Variable | Purpose | How to Generate |
|----------|---------|-----------------|
| `JWT_SECRET` | Signs authentication tokens | `openssl rand -hex 32` |
| `ENCRYPTION_SECRET` | Encrypts user API keys | `openssl rand -hex 32` |
| `SUPABASE_SERVICE_KEY` | Verifies Supabase tokens | From Supabase Dashboard |

**⚠️ NEVER use default values in production!**

### Files to NEVER Commit

- `.env` (contains secrets)
- `*.db` (SQLite database)
- `firebase-credentials.json` (deprecated but may exist)
- `node_modules/` (use `npm install` instead)
- `__pycache__/` (Python cache)

## 🛡️ Security Headers

The application includes:

- **X-Content-Type-Options: nosniff** - Prevents MIME sniffing
- **X-Frame-Options: DENY** - Prevents clickjacking
- **X-XSS-Protection: 1; mode=block** - XSS filter
- **Referrer-Policy: strict-origin-when-cross-origin** - Controls referrer info
- **Content-Security-Policy** - Restricts resource loading

## 📊 Supabase Security

### Required Configuration

1. **Enable RLS (Row Level Security)** on all tables:
   ```sql
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
   -- etc.
   ```

2. **Create RLS policies** for each table

3. **Restrict CORS** in Supabase dashboard to your domains

4. **Use separate keys**:
   - `anon` key for frontend (public)
   - `service_role` key for backend (secret)

## 🔒 Production Checklist

- [ ] Changed JWT_SECRET from default
- [ ] Changed ENCRYPTION_SECRET from default
- [ ] Configured Supabase with RLS policies
- [ ] Removed Firebase credentials (if not using)
- [ ] Set proper CORS origins
- [ ] Enabled HTTPS for web deployments
- [ ] Removed `.env` from version control
- [ ] Added `.env` to `.gitignore`

## 🚨 Code Signing (Windows)

Without code signing, Windows will show "Unknown Publisher" warnings.

**Options:**
- **Standard Code Signing** (~$200-700/year) - Shows publisher name
- **EV Code Signing** (~$300-1000/year) - Removes SmartScreen warnings immediately

Providers: DigiCert, Sectigo, Certum

## 🔧 Security Updates

Keep dependencies updated:

```bash
# Frontend
cd frontend
npm audit fix

# Backend
cd backend
pip list --outdated
```

## 📞 Reporting Security Issues

If you discover a security vulnerability, please report it responsibly.

## Recent Security Changes

- **2026-03-31**: Removed Google OAuth (Firebase) authentication
- **2026-03-31**: Added Content Security Policy (CSP)
- **2026-03-31**: Added security headers middleware
- **2026-03-31**: Removed `google_id` from database schema
