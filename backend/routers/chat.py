"""
routers/chat.py — WebSocket real-time chat + agent code execution

Message types:
  agent_plan         — broadcast when plan is generated (shows steps in chat)
  agent_step_start   — a step is starting
  agent_step_done    — a step completed (with diff_id if code change)
  agent_job_done     — all steps done
  file_accepted      — a diff was accepted; all clients should reload that file
  file_rejected      — a diff was rejected
"""
import uuid, json
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.database import DB_PATH
from core.auth import decode_token
from core.agent_executor import generate_plan, execute_plan
import aiosqlite

router = APIRouter()

CODE_INSTRUCTION_HINTS = [
    "@agent create", "@agent modify", "@agent refactor",
    "@agent add", "@agent fix", "@agent update", "@agent write",
    "@agent build", "@agent make", "@agent delete", "@agent remove",
    "@agent explain",
]

def _is_code_instruction(content: str) -> bool:
    low = content.lower()
    if "@agent" not in low:
        return False
    for hint in CODE_INSTRUCTION_HINTS:
        if hint in low:
            return True
    return True


# ── Connection manager ─────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, list] = {}

    async def connect(self, ws: WebSocket, project_id: str, user_id: str, username: str):
        await ws.accept()
        if project_id not in self.rooms:
            self.rooms[project_id] = []
        self.rooms[project_id].append((ws, user_id, username))

    def disconnect(self, ws: WebSocket, project_id: str):
        if project_id in self.rooms:
            self.rooms[project_id] = [(w, u, n) for w, u, n in self.rooms[project_id] if w != ws]

    async def broadcast(self, project_id: str, message: dict, exclude_ws=None):
        if project_id not in self.rooms:
            return
        dead = []
        for ws, uid, uname in self.rooms[project_id]:
            if ws == exclude_ws:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, project_id)

    async def broadcast_all(self, project_id: str, message: dict):
        await self.broadcast(project_id, message)

    async def send_to(self, ws: WebSocket, message: dict):
        try:
            await ws.send_json(message)
        except Exception:
            pass


manager = ConnectionManager()


# ── DB helpers ─────────────────────────────────────────────────────────────────

async def _save_message(project_id, author_id, author_name, content, is_agent=False, agent_model=None, triggered_by=None):
    msg_id = str(uuid.uuid4())
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO messages (id, project_id, author_id, author_name, content, is_agent, agent_model, triggered_by) VALUES (?,?,?,?,?,?,?,?)",
            (msg_id, project_id, author_id, author_name, content, is_agent, agent_model, triggered_by)
        )
        await db.commit()
    return msg_id


async def _get_thread_context(project_id: str, limit=30) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM messages WHERE project_id=? ORDER BY created_at DESC LIMIT ?",
            (project_id, limit)
        ) as cur:
            rows = await cur.fetchall()
    rows = list(reversed(rows))
    return [{"role": "assistant" if r["is_agent"] else "user", "content": f"[{r['author_name']}]: {r['content']}"} for r in rows]


async def _get_file_lookup(project_id: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, filename, content, language FROM workspace_files WHERE project_id=?",
            (project_id,)
        ) as cur:
            rows = await cur.fetchall()
    return {r["filename"]: {"id": r["id"], "content": r["content"], "language": r["language"]} for r in rows}


async def _get_context_snippets(file_lookup: dict, max_chars=3000) -> str:
    parts = []
    total = 0
    for filename, info in file_lookup.items():
        snippet = info["content"][:500]
        entry   = f"### {filename}\n{snippet}"
        if total + len(entry) > max_chars:
            break
        parts.append(entry)
        total += len(entry)
    return "\n\n".join(parts)


# ── Check whether user has a usable API key for their chosen model ─────────────

async def _get_groq_key_for_user(user_id: str) -> str | None:
    """Returns the user's own Groq key if saved, else None. Never falls back to server env."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT key_value FROM user_api_keys WHERE user_id=? AND provider='groq'",
            (user_id,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    try:
        from core.encryption import decrypt
        return decrypt(row["key_value"])
    except Exception:
        return None


async def _user_has_key_for_model(user_id: str, model_id: str) -> bool:
    """Check whether the user has saved the required API key for the given model."""
    from core.models import get_provider
    provider = get_provider(model_id)

    if provider == "groq":
        # Free-tier model — user must have their own Groq key
        key = await _get_groq_key_for_user(user_id)
        return key is not None

    if provider == "ollama":
        # Ollama runs locally — always OK (url optional)
        return True

    # BYOK providers — check saved keys table
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT 1 FROM user_api_keys WHERE user_id=? AND provider=?",
            (user_id, provider)
        ) as cur:
            return bool(await cur.fetchone())


# ── Non-code agent response ────────────────────────────────────────────────────

async def _call_chat_agent(project_id: str, model: str, username: str, trigger_message: str, user_id: str) -> str:
    from core.llm import call_llm
    context = await _get_thread_context(project_id)
    system  = (
        f"You are an AI agent for {username} in a collaborative team workspace called Yantrik. "
        f"You have access to the full conversation thread. Be helpful and concise."
    )
    messages = context + [{"role": "user", "content": trigger_message}]
    try:
        return await call_llm(model, messages, system, user_id)
    except Exception as e:
        return f"⚠️ Agent error: {e}"


# ── IDE agent: plan + execute ──────────────────────────────────────────────────

async def _run_ide_agent(
    project_id: str,
    job_id: str,
    user_id: str,
    username: str,
    model: str,
    instruction: str,
    websocket: WebSocket,
):
    # ── Key check: user must have their own API key configured ────────────────
    has_key = await _user_has_key_for_model(user_id, model)
    if not has_key:
        from core.models import get_provider
        provider = get_provider(model)
        key_url = {
            "groq":      "https://console.groq.com/keys",
            "openai":    "https://platform.openai.com/api-keys",
            "anthropic": "https://console.anthropic.com/settings/keys",
            "google":    "https://aistudio.google.com/app/apikey",
        }.get(provider, "your provider's dashboard")

        await manager.broadcast_all(project_id, {
            "type":  "agent_error",
            "username": username,
            "error": (
                f"⚠️ No {provider.title()} API key found. "
                f"Add your key in Profile → API Keys ({key_url}) before using the agent."
            )
        })
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE agent_jobs SET status='failed', completed_at=? WHERE id=?",
                (datetime.utcnow().isoformat(), job_id)
            )
            await db.commit()
        return

    file_lookup      = await _get_file_lookup(project_id)
    file_list        = list(file_lookup.keys())
    context_snippets = await _get_context_snippets(file_lookup)
    ts               = datetime.utcnow().isoformat()

    # ── Step 1: Generate plan ────────────────────────────────────────
    await manager.broadcast_all(project_id, {
        "type": "agent_thinking", "username": username,
        "message": "Planning...", "timestamp": ts
    })

    try:
        plan = await generate_plan(instruction, file_list, model, user_id, context_snippets)
    except ValueError as e:
        await manager.broadcast_all(project_id, {
            "type": "agent_error", "username": username, "error": str(e)
        })
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE agent_jobs SET status='failed', completed_at=? WHERE id=?",
                (ts, job_id)
            )
            await db.commit()
        return

    # Store plan in DB
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE agent_jobs SET status='running', plan_json=? WHERE id=?",
            (json.dumps(plan), job_id)
        )
        await db.commit()

    # Broadcast plan so everyone sees steps in chat
    await manager.broadcast_all(project_id, {
        "type":      "agent_plan",
        "job_id":    job_id,
        "username":  username,
        "goal":      plan["goal"],
        "steps":     plan["steps"],
        "timestamp": ts,
    })

    # ── Step 2: Execute each step, broadcasting start+done one at a time ──────
    results = []

    async def on_step_start(step: dict):
        await manager.broadcast_all(project_id, {
            "type":        "agent_step_start",
            "job_id":      job_id,
            "step_number": step.get("step_number"),
            "action":      step.get("action"),
            "target_file": step.get("target_file"),
            "username":    username,
            "timestamp":   datetime.utcnow().isoformat(),
        })

    async def on_step_done(result: dict):
        results.append(result)
        await manager.broadcast_all(project_id, {
            "type":          "agent_step_done",
            "job_id":        job_id,
            "step_number":   result["step_number"],
            "action":        result["action"],
            "target_file":   result["target_file"],
            "status":        result["status"],
            "output":        result["output"],
            "diff_id":       result.get("diff_id"),
            "lines_added":   result.get("lines_added"),
            "lines_removed": result.get("lines_removed"),
            "risk_level":    result.get("risk_level"),
            "error":         result.get("error"),
            "username":      username,
            "timestamp":     datetime.utcnow().isoformat(),
        })

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        for step in plan.get("steps", []):
            await on_step_start(step)

            # Execute one step at a time
            step_results = await execute_plan(
                plan={"goal": plan["goal"], "steps": [step]},
                job_id=job_id,
                project_id=project_id,
                file_lookup=file_lookup,
                model=model,
                user_id=user_id,
                db=db,
                step_callback=on_step_done,
            )
            # Refresh file_lookup so subsequent steps see newly created files
            file_lookup = await _get_file_lookup(project_id)

    # ── Finalise job ─────────────────────────────────────────────────
    now = datetime.utcnow().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE agent_jobs SET status='done', results_json=?, completed_at=? WHERE id=?",
            (json.dumps(results), now, job_id)
        )
        await db.commit()

    await manager.broadcast_all(project_id, {
        "type":       "agent_job_done",
        "job_id":     job_id,
        "username":   username,
        "goal":       plan["goal"],
        "step_count": len(results),
        "timestamp":  now,
    })

    pending_count = sum(1 for r in results if r["status"] == "pending_review")
    summary = f"✅ Done: {plan['goal']}"
    if pending_count:
        summary += f" — {pending_count} file change(s) ready for review in the Files panel."
    agent_name = f"{username}'s Agent"
    msg_id = await _save_message(project_id, None, agent_name, summary, is_agent=True, agent_model=model, triggered_by=user_id)
    await manager.broadcast_all(project_id, {
        "type":        "message",
        "id":          msg_id,
        "author_name": agent_name,
        "avatar_color": "#6366f1",
        "content":     summary,
        "is_agent":    True,
        "agent_model": model,
        "timestamp":   now,
    })


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return
    try:
        payload = decode_token(token)
        user_id = payload["sub"]
    except Exception:
        await websocket.close(code=4001)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT u.username, u.avatar_color, pm.model FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? AND pm.user_id=?",
            (project_id, user_id)
        ) as cur:
            member = await cur.fetchone()

    if not member:
        await websocket.close(code=4003)
        return

    username     = member["username"]
    avatar_color = member["avatar_color"]
    model        = member["model"]

    await manager.connect(websocket, project_id, user_id, username)
    await manager.broadcast_all(project_id, {
        "type": "system", "content": f"{username} joined the workspace",
        "timestamp": datetime.utcnow().isoformat()
    })

    try:
        while True:
            data     = await websocket.receive_json()
            msg_type = data.get("type", "message")

            # ── Regular chat message ───────────────────────────────
            if msg_type == "message":
                content = data.get("content", "").strip()[:4000]
                if not content:
                    continue

                msg_id = await _save_message(project_id, user_id, username, content)
                await manager.broadcast_all(project_id, {
                    "type": "message", "id": msg_id,
                    "author_id": user_id, "author_name": username,
                    "avatar_color": avatar_color, "content": content,
                    "is_agent": False, "timestamp": datetime.utcnow().isoformat()
                })

                if "@agent" in content.lower():
                    # Refresh model from DB in case it changed
                    async with aiosqlite.connect(DB_PATH) as db:
                        db.row_factory = aiosqlite.Row
                        async with db.execute(
                            "SELECT model FROM project_members WHERE project_id=? AND user_id=?",
                            (project_id, user_id)
                        ) as cur:
                            fresh = await cur.fetchone()
                        current_model = fresh["model"] if fresh else model

                    # ── Immediate key check — reply instantly, don't spawn a task ──
                    has_key = await _user_has_key_for_model(user_id, current_model)
                    if not has_key:
                        from core.models import get_provider
                        provider = get_provider(current_model)
                        key_url = {
                            "groq":      "https://console.groq.com/keys",
                            "openai":    "https://platform.openai.com/api-keys",
                            "anthropic": "https://console.anthropic.com/settings/keys",
                            "google":    "https://aistudio.google.com/app/apikey",
                        }.get(provider, "your provider's dashboard")
                        # Send only to the user who typed — no need to bother others
                        await manager.send_to(websocket, {
                            "type":     "agent_no_key",
                            "provider": provider,
                            "key_url":  key_url,
                            "model":    current_model,
                            "timestamp": datetime.utcnow().isoformat(),
                        })
                        continue  # Don't create job or spawn task

                    if _is_code_instruction(content):
                        # IDE: plan + execute code
                        job_id = str(uuid.uuid4())
                        async with aiosqlite.connect(DB_PATH) as db:
                            await db.execute(
                                "INSERT INTO agent_jobs (id, project_id, triggered_by, instruction, model, status) VALUES (?,?,?,?,?,'pending')",
                                (job_id, project_id, user_id, content, current_model)
                            )
                            await db.commit()

                        import asyncio
                        asyncio.create_task(_run_ide_agent(
                            project_id, job_id, user_id, username,
                            current_model, content, websocket
                        ))
                    else:
                        # Regular chat agent
                        await manager.broadcast_all(project_id, {
                            "type": "agent_typing", "username": username, "model": current_model
                        })
                        agent_response = await _call_chat_agent(project_id, current_model, username, content, user_id)
                        agent_name     = f"{username}'s Agent"
                        agent_msg_id   = await _save_message(
                            project_id, None, agent_name, agent_response,
                            is_agent=True, agent_model=current_model, triggered_by=user_id
                        )
                        await manager.broadcast_all(project_id, {
                            "type": "message", "id": agent_msg_id,
                            "author_name": agent_name, "avatar_color": avatar_color,
                            "content": agent_response, "is_agent": True,
                            "agent_model": current_model, "triggered_by": username,
                            "timestamp": datetime.utcnow().isoformat()
                        })

            # ── Diff accepted/rejected notifications ───────────────
            elif msg_type == "diff_accepted":
                await manager.broadcast(project_id, {
                    "type":      "file_accepted",
                    "diff_id":   data.get("diff_id"),
                    "file_id":   data.get("file_id"),
                    "filename":  data.get("filename"),
                    "content":   data.get("content"),
                    "timestamp": datetime.utcnow().isoformat(),
                }, exclude_ws=websocket)

            elif msg_type == "diff_rejected":
                await manager.broadcast(project_id, {
                    "type":      "file_rejected",
                    "diff_id":   data.get("diff_id"),
                    "filename":  data.get("filename"),
                    "timestamp": datetime.utcnow().isoformat(),
                }, exclude_ws=websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)
        await manager.broadcast_all(project_id, {
            "type": "system", "content": f"{username} left the workspace",
            "timestamp": datetime.utcnow().isoformat()
        })
