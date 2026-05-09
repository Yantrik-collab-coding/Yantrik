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
from core.agent_executor import generate_plan, execute_plan, update_project_memory, MEMORY_FILENAME
import aiosqlite

router = APIRouter()

CODE_INSTRUCTION_HINTS = [
    "@agent create", "@agent modify", "@agent refactor",
    "@agent add", "@agent fix", "@agent update", "@agent write",
    "@agent build", "@agent make", "@agent delete", "@agent remove",
    "@agent explain",
    "@agent scaffold", "@agent generate", "@agent build project",
    "@agent create project", "@agent initialize", "@agent init",
    "@agent setup project",
]

def _is_code_instruction(content: str) -> bool:
    low = content.lower()
    if "@agent" not in low:
        return False
    for hint in CODE_INSTRUCTION_HINTS:
        if hint in low:
            return True
    return False


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


async def _get_project_memory(project_id: str) -> tuple[str, str | None]:
    """Returns (memory_content, file_id) for YANTRIK_MEMORY.md, or ('', None) if not yet created."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, content FROM workspace_files WHERE project_id=? AND filename='YANTRIK_MEMORY.md'",
            (project_id,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return "", None
    return row["content"] or "", row["id"]


def _get_target_file_content(file_lookup: dict, instruction: str) -> str:
    """
    Best-effort: find the file most likely being targeted in the instruction
    and return its full content. Falls back to empty string.
    """
    low = instruction.lower()
    for filename, info in file_lookup.items():
        if filename.lower() in low:
            return info["content"][:MAX_FILE_SNIPPET]
    return ""


MAX_FILE_SNIPPET = 6000  # chars for target file injection


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
    file_lookup = await _get_file_lookup(project_id)
    file_list = list(file_lookup.keys())
    files_str = ", ".join(file_list[:15]) if file_list else "none yet"

    system = (
        f"You are a friendly AI coding assistant for {username} in a collaborative team IDE called Yantrik. "
        f"You are chatting in real-time with the team.\n\n"
        f"Current workspace files: {files_str}\n\n"
        f"Guidelines:\n"
        f"- Respond naturally and conversationally to greetings, questions, and casual messages\n"
        f"- When discussing code, use markdown: **bold**, `inline code`, and ```language fenced code blocks```\n"
        f"- Be concise but helpful — this is a chat, not a document\n"
        f"- If the user asks you to create or modify files, tell them to use '@agent create ...' or '@agent modify ...' commands\n"
        f"- You can explain code, suggest approaches, answer questions about programming, debugging, architecture, etc.\n"
        f"- Be friendly and supportive, like a helpful teammate"
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

    file_lookup          = await _get_file_lookup(project_id)
    file_list            = list(file_lookup.keys())
    project_memory, _    = await _get_project_memory(project_id)
    target_file_content  = _get_target_file_content(file_lookup, instruction)
    ts                   = datetime.utcnow().isoformat()

    # ── Step 1: Generate plan ────────────────────────────────────────
    await manager.broadcast_all(project_id, {
        "type": "agent_thinking", "username": username,
        "message": "Planning...", "timestamp": ts
    })

    try:
        plan = await generate_plan(
            instruction, file_list, model, user_id,
            project_memory=project_memory,
            target_file_content=target_file_content,
        )
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
            "new_content":   result.get("new_content", ""),
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

    now = datetime.utcnow().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            "UPDATE agent_jobs SET status='done', results_json=?, completed_at=? WHERE id=?",
            (json.dumps(results), now, job_id)
        )
        await db.commit()

        # ── Update project memory ────────────────────────────────────
        try:
            new_memory = await update_project_memory(
                project_id=project_id,
                goal=plan["goal"],
                results=results,
                model=model,
                user_id=user_id,
                db=db,
            )
            # Broadcast updated memory to all connected members so their local DB stays in sync
            await manager.broadcast_all(project_id, {
                "type":     "memory_update",
                "content":  new_memory,
                "filename": MEMORY_FILENAME,
                "timestamp": now,
            })
        except Exception:
            pass  # Memory update failing should never break the job

    # ── Auto-run: verify the code actually works ──────────────────────────────
    import subprocess, tempfile, os as _os, asyncio

    # Find the last modified/created Python file in this job
    py_targets = [
        r["target_file"] for r in results
        if r.get("target_file", "").endswith(".py") and r.get("status") == "done"
    ]

    if py_targets:
        target_filename = py_targets[-1]
        # Fetch the latest content from DB
        async with aiosqlite.connect(DB_PATH) as _db:
            _db.row_factory = aiosqlite.Row
            async with _db.execute(
                "SELECT content FROM workspace_files WHERE project_id=? AND filename=?",
                (project_id, target_filename)
            ) as _cur:
                _file_row = await _cur.fetchone()

        if _file_row and _file_row["content"]:
            _content = _file_row["content"]

            # Skip interactive programs
            _interactive = any(p in _content for p in ["input(", "raw_input(", "stdin.read", "getpass("])
            if not _interactive:
                await manager.broadcast_all(project_id, {
                    "type": "agent_thinking", "username": username,
                    "message": f"Running {target_filename} to verify...", "timestamp": datetime.utcnow().isoformat()
                })

                _run_summary = None
                _tmp = None
                try:
                    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as _f:
                        _f.write(_content)
                        _tmp = _f.name

                    loop = asyncio.get_event_loop()
                    _proc = await loop.run_in_executor(None, lambda: subprocess.run(
                        ["python", _tmp],
                        capture_output=True, text=True, timeout=8,
                        cwd=tempfile.gettempdir()
                    ))

                    if _proc.returncode == 0:
                        _run_output = _proc.stdout.strip()[:800] or "(no output)"
                        _run_summary = f"✅ `{target_filename}` ran successfully:\n```\n{_run_output}\n```"
                    else:
                        _run_err = (_proc.stderr or _proc.stdout or "unknown error").strip()[:800]
                        _run_summary = f"⚠️ `{target_filename}` has a runtime error:\n```\n{_run_err}\n```\nYou may need to fix it."

                except subprocess.TimeoutExpired:
                    _run_summary = f"⏱ `{target_filename}` timed out after 8s. It may have an infinite loop."
                except FileNotFoundError:
                    _run_summary = None  # Python not available on server, skip silently
                except Exception as _e:
                    _run_summary = f"⚠️ Could not run `{target_filename}`: {_e}"
                finally:
                    try:
                        if _tmp:
                            _os.unlink(_tmp)
                    except Exception:
                        pass

                if _run_summary:
                    _agent_name = f"{username}'s Agent"
                    _run_msg_id = await _save_message(
                        project_id, None, _agent_name, _run_summary,
                        is_agent=True, agent_model=model, triggered_by=user_id
                    )
                    await manager.broadcast_all(project_id, {
                        "type": "message", "id": _run_msg_id,
                        "author_name": _agent_name, "avatar_color": "#6366f1",
                        "content": _run_summary, "is_agent": True,
                        "agent_model": model, "timestamp": datetime.utcnow().isoformat()
                    })

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

    # Push current project memory to the joining member so their local state is up to date
    memory_content, _ = await _get_project_memory(project_id)
    if memory_content:
        await manager.send_to(websocket, {
            "type":      "memory_update",
            "content":   memory_content,
            "filename":  MEMORY_FILENAME,
            "timestamp": datetime.utcnow().isoformat(),
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
    except (RuntimeError, Exception) as e:
        # Handles "WebSocket is not connected" and other unexpected errors
        # so a client refresh doesn't crash the server
        manager.disconnect(websocket, project_id)
        try:
            await manager.broadcast_all(project_id, {
                "type": "system", "content": f"{username} left the workspace",
                "timestamp": datetime.utcnow().isoformat()
            })
        except Exception:
            pass
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
