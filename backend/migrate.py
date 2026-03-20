"""
migrate.py — Safe for both fresh installs and existing databases.

Fresh install  : creates the full schema from scratch using stdlib sqlite3
Existing DB    : adds any missing columns/tables idempotently

Usage:
    python migrate.py

Always safe to re-run — every operation is idempotent.
"""
import sqlite3, secrets, string, os, sys

DB_PATH = os.getenv("DB_PATH", "hive.db")

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row


def table_exists(name: str) -> bool:
    return bool(db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


# ── Fresh install: create base schema if users table doesn't exist ────────────

if not table_exists("users"):
    print(f"Creating fresh schema in {DB_PATH}...\n")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id                     TEXT PRIMARY KEY,
            email                  TEXT UNIQUE NOT NULL,
            username               TEXT UNIQUE NOT NULL,
            password_hash          TEXT NOT NULL,
            avatar_color           TEXT DEFAULT '#6366f1',
            byok_enabled           INTEGER DEFAULT 0,
            ollama_enabled         INTEGER DEFAULT 0,
            uid                    TEXT UNIQUE,
            google_id              TEXT UNIQUE,
            stripe_subscription_id TEXT,
            stripe_plan            TEXT,
            created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_api_keys (
            user_id    TEXT NOT NULL,
            provider   TEXT NOT NULL,
            key_value  TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, provider),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS projects (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            description  TEXT,
            owner_id     TEXT NOT NULL,
            invite_code  TEXT UNIQUE NOT NULL,
            is_public    INTEGER DEFAULT 0,
            tags         TEXT DEFAULT '',
            viewer_count INTEGER DEFAULT 0,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS project_members (
            project_id TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            model      TEXT DEFAULT 'llama-3.3-70b-versatile',
            role       TEXT DEFAULT 'member',
            joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (user_id)    REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id           TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL,
            author_id    TEXT,
            author_name  TEXT NOT NULL,
            content      TEXT NOT NULL,
            is_agent     BOOLEAN DEFAULT FALSE,
            agent_model  TEXT,
            triggered_by TEXT,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS workspace_files (
            id         TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            filename   TEXT NOT NULL,
            content    TEXT NOT NULL DEFAULT '',
            language   TEXT NOT NULL DEFAULT 'plaintext',
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (project_id, filename),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS file_versions (
            id         TEXT PRIMARY KEY,
            file_id    TEXT NOT NULL,
            project_id TEXT NOT NULL,
            content    TEXT NOT NULL,
            saved_by   TEXT DEFAULT 'user',
            message    TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id)    REFERENCES workspace_files(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS agent_jobs (
            id           TEXT PRIMARY KEY,
            project_id   TEXT NOT NULL,
            triggered_by TEXT NOT NULL,
            instruction  TEXT NOT NULL,
            model        TEXT NOT NULL,
            status       TEXT DEFAULT 'pending',
            plan_json    TEXT,
            results_json TEXT,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            FOREIGN KEY (project_id)   REFERENCES projects(id),
            FOREIGN KEY (triggered_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS pending_diffs (
            id            TEXT PRIMARY KEY,
            job_id        TEXT NOT NULL,
            project_id    TEXT NOT NULL,
            file_id       TEXT,
            filename      TEXT NOT NULL,
            old_content   TEXT NOT NULL DEFAULT '',
            new_content   TEXT NOT NULL,
            diff_text     TEXT NOT NULL,
            lines_added   INTEGER DEFAULT 0,
            lines_removed INTEGER DEFAULT 0,
            risk_level    TEXT DEFAULT 'low',
            status        TEXT DEFAULT 'pending',
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at   TIMESTAMP,
            FOREIGN KEY (job_id)     REFERENCES agent_jobs(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS join_requests (
            id         TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            message    TEXT DEFAULT '',
            status     TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (user_id)    REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS hackathons (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            description   TEXT DEFAULT '',
            organizer_id  TEXT NOT NULL,
            max_teams     INTEGER DEFAULT 10,
            max_per_team  INTEGER DEFAULT 4,
            start_time    TIMESTAMP,
            end_time      TIMESTAMP,
            status        TEXT DEFAULT 'upcoming',
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (organizer_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS hackathon_teams (
            id           TEXT PRIMARY KEY,
            hackathon_id TEXT NOT NULL,
            name         TEXT NOT NULL,
            leader_id    TEXT NOT NULL,
            project_id   TEXT,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (hackathon_id) REFERENCES hackathons(id),
            FOREIGN KEY (leader_id)    REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS hackathon_team_members (
            team_id   TEXT NOT NULL,
            user_id   TEXT NOT NULL,
            role      TEXT DEFAULT 'member',
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (team_id, user_id),
            FOREIGN KEY (team_id) REFERENCES hackathon_teams(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS hackathon_judges (
            hackathon_id TEXT NOT NULL,
            user_id      TEXT NOT NULL,
            PRIMARY KEY (hackathon_id, user_id),
            FOREIGN KEY (hackathon_id) REFERENCES hackathons(id),
            FOREIGN KEY (user_id)      REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS friends (
            id          TEXT PRIMARY KEY,
            sender_id   TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            status      TEXT DEFAULT 'pending',
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(sender_id, receiver_id),
            FOREIGN KEY (sender_id)   REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS project_viewers (
            project_id TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (project_id, user_id)
        );
    """)
    db.commit()
    print("✓ All tables created.")
    print("\nDone — fresh install complete.")
    db.close()
    sys.exit(0)


# ── Existing DB: apply incremental migrations ─────────────────────────────────

print(f"Existing database found at {DB_PATH} — applying migrations...\n")

col_migrations = [
    ("ALTER TABLE users ADD COLUMN byok_enabled INTEGER DEFAULT 0",       "users.byok_enabled"),
    ("ALTER TABLE users ADD COLUMN ollama_enabled INTEGER DEFAULT 0",     "users.ollama_enabled"),
    ("ALTER TABLE users ADD COLUMN uid TEXT",                             "users.uid"),
    ("ALTER TABLE users ADD COLUMN google_id TEXT",                       "users.google_id"),
    ("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT",          "users.stripe_subscription_id"),
    ("ALTER TABLE users ADD COLUMN stripe_plan TEXT",                     "users.stripe_plan"),
    ("ALTER TABLE projects ADD COLUMN is_public INTEGER DEFAULT 0",       "projects.is_public"),
    ("ALTER TABLE projects ADD COLUMN tags TEXT DEFAULT ''",              "projects.tags"),
    ("ALTER TABLE projects ADD COLUMN viewer_count INTEGER DEFAULT 0",    "projects.viewer_count"),
    ("ALTER TABLE project_members ADD COLUMN role TEXT DEFAULT 'member'", "project_members.role"),
]

for sql, label in col_migrations:
    try:
        db.execute(sql)
        print(f"  ✓ Added    {label}")
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            print(f"  — Exists  {label}")
        else:
            print(f"  ⚠  Error  {label}: {e}")

table_migrations = [
    ("user_api_keys", """CREATE TABLE IF NOT EXISTS user_api_keys (
        user_id TEXT NOT NULL, provider TEXT NOT NULL, key_value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, provider))"""),
    ("join_requests", """CREATE TABLE IF NOT EXISTS join_requests (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
        message TEXT DEFAULT '', status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, user_id))"""),
    ("project_viewers", """CREATE TABLE IF NOT EXISTS project_viewers (
        project_id TEXT NOT NULL, user_id TEXT NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, user_id))"""),
    ("hackathons", """CREATE TABLE IF NOT EXISTS hackathons (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
        organizer_id TEXT NOT NULL, max_teams INTEGER DEFAULT 10,
        max_per_team INTEGER DEFAULT 4, start_time TIMESTAMP, end_time TIMESTAMP,
        status TEXT DEFAULT 'upcoming', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"""),
    ("hackathon_teams", """CREATE TABLE IF NOT EXISTS hackathon_teams (
        id TEXT PRIMARY KEY, hackathon_id TEXT NOT NULL, name TEXT NOT NULL,
        leader_id TEXT NOT NULL, project_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"""),
    ("hackathon_team_members", """CREATE TABLE IF NOT EXISTS hackathon_team_members (
        team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (team_id, user_id))"""),
    ("hackathon_judges", """CREATE TABLE IF NOT EXISTS hackathon_judges (
        hackathon_id TEXT NOT NULL, user_id TEXT NOT NULL,
        PRIMARY KEY (hackathon_id, user_id))"""),
    ("friends", """CREATE TABLE IF NOT EXISTS friends (
        id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sender_id, receiver_id))"""),
]

for name, sql in table_migrations:
    try:
        db.execute(sql)
        print(f"  ✓ Table    {name}")
    except Exception as e:
        print(f"  ⚠  Table   {name}: {e}")

# ── Backfill UIDs for existing users ─────────────────────────────────────────

chars = string.ascii_uppercase + string.digits
try:
    needs_uid = db.execute("SELECT id FROM users WHERE uid IS NULL").fetchall()
    if needs_uid:
        for u in needs_uid:
            uid = ''.join(secrets.choice(chars) for _ in range(8))
            db.execute("UPDATE users SET uid=? WHERE id=?", (uid, u["id"]))
            print(f"  ✓ UID      {uid} → user {u['id'][:8]}...")
        print(f"\n  Backfilled {len(needs_uid)} UID(s)")
    else:
        print("  — All users already have UIDs")
except Exception as e:
    print(f"  ⚠  UID backfill: {e}")

db.commit()
db.close()
print("\nMigration complete.")
