import aiosqlite
import os

DB_PATH = os.getenv("DB_PATH", "hive.db")


async def get_db():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
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
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                owner_id    TEXT NOT NULL,
                invite_code TEXT UNIQUE NOT NULL,
                is_public   INTEGER DEFAULT 0,
                tags        TEXT DEFAULT '',
                viewer_count INTEGER DEFAULT 0,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
                id            TEXT PRIMARY KEY,
                hackathon_id  TEXT NOT NULL,
                name          TEXT NOT NULL,
                leader_id     TEXT NOT NULL,
                project_id    TEXT,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (hackathon_id) REFERENCES hackathons(id),
                FOREIGN KEY (leader_id)   REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS hackathon_team_members (
                team_id    TEXT NOT NULL,
                user_id    TEXT NOT NULL,
                role       TEXT DEFAULT 'member',
                joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
                id         TEXT PRIMARY KEY,
                sender_id  TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                status     TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
        await db.commit()
