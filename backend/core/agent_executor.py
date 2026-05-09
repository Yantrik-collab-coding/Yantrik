"""
agent_executor.py — Plan → Execute engine for Yantrik IDE
Routes to any LLM provider via core/llm.py (Groq / OpenAI / Anthropic / Google / Ollama).

Flow:
  1. generate_plan()     — LLM produces structured JSON plan
  2. execute_plan()      — runs each step, generates diffs, stores pending_diffs
  3. Caller broadcasts   — WebSocket events to all room members
"""
import re
import ast
import json
import uuid
from typing import Optional
from datetime import datetime
from core.llm import call_llm
from core.diff_engine import generate_unified_diff, score_risk, count_changes

VALID_ACTIONS = {"create_file", "modify_file", "explain"}
MAX_FILE_CHARS = 8000
MEMORY_FILENAME = "YANTRIK_MEMORY.md"


MEMORY_UPDATE_SYSTEM = """You maintain a compact project memory file for a coding project.
Update it based on what the agent just did.

Rules:
- Return ONLY the updated memory text. No markdown fences. No explanation.
- Never use ##, **, or timestamps.
- Completed items are numbered sequentially (continue from existing highest number).
- Merge related items — do not duplicate.
- Keep each line short. Every word costs tokens.
- Sections: Goal, Stack, Completed, In Progress, Architecture Decisions, Known Issues
- If a section has nothing, omit it entirely."""


async def get_project_memory(project_id: str, db) -> tuple[str, str | None]:
    """Returns (memory_content, file_id). file_id is None if file doesn't exist yet."""
    async with db.execute(
        "SELECT id, content FROM workspace_files WHERE project_id=? AND filename=?",
        (project_id, MEMORY_FILENAME)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return "", None
    return row["content"] or "", row["id"]


async def update_project_memory(
    project_id: str,
    goal: str,
    results: list[dict],
    model: str,
    user_id: str,
    db,
) -> str:
    """
    After a job completes, LLM merges what was done into YANTRIK_MEMORY.md.
    Writes the updated file back to workspace_files.
    Returns the new memory content.
    """
    db.row_factory = __import__('aiosqlite').Row
    old_memory, file_id = await get_project_memory(project_id, db)

    # Build a compact summary of what was done
    done_lines = []
    for r in results:
        if r["status"] in ("done", "pending_review"):
            done_lines.append(f"- {r['action']} {r['target_file']}: {r.get('output', '')[:120]}")
    done_summary = "\n".join(done_lines) if done_lines else "- No file changes."

    user_prompt = (
        f"Existing memory:\n{old_memory}\n\n"
        f"Agent just completed goal: {goal}\n"
        f"Steps done:\n{done_summary}\n\n"
        f"Return the updated memory file."
    )

    new_memory = await call_llm(
        model_id=model,
        messages=[{"role": "user", "content": user_prompt}],
        system=MEMORY_UPDATE_SYSTEM,
        user_id=user_id,
        max_tokens=600,
        temperature=0.1,
    )
    new_memory = new_memory.strip()

    # Upsert into workspace_files
    if file_id:
        await db.execute(
            "UPDATE workspace_files SET content=?, updated_at=? WHERE id=?",
            (new_memory, datetime.utcnow().isoformat(), file_id)
        )
    else:
        import uuid as _uuid
        new_id = str(_uuid.uuid4())
        await db.execute(
            "INSERT INTO workspace_files (id, project_id, filename, content, language) VALUES (?,?,?,?,?)",
            (new_id, project_id, MEMORY_FILENAME, new_memory, "markdown")
        )
    await db.commit()
    return new_memory


PLAN_SYSTEM = """You are an AI coding agent inside a collaborative IDE called Yantrik.
Given a user instruction, produce a complete JSON execution plan.

Rules:
- Return ONLY valid JSON. No markdown. No explanation.
- Valid actions: "create_file", "modify_file", "explain"
- For full project generation, create ALL necessary files (main file, config,
  helpers, README, requirements.txt etc.) as separate steps.
- Each step creates or modifies exactly ONE file.
- Steps run in order — later steps can depend on files created in earlier steps.
- Write complete, production-ready file contents in the instruction field.
  Be specific about imports, function signatures, and how files relate to each other.
- For "create_file", describe the COMPLETE file content in the instruction.
- target_file MUST be an existing filename for modify_file/explain.
- For create_file, target_file is the new filename to create.
- ALWAYS use folder/path structure for multi-file projects. Examples:
    backend/main.py, backend/models.py, backend/routes.py
    frontend/src/App.tsx, frontend/src/components/Button.tsx
    frontend/public/index.html
- For a full-stack app, always separate backend and frontend into folders.
- For a Flask/FastAPI app: put all Python files under backend/
- For a React app: use frontend/src/ for components, frontend/public/ for static
- target_file MUST include the full relative path with folders.
    CORRECT:   "target_file": "backend/routes.py"
    INCORRECT: "target_file": "routes.py"
- Never create all files at the root level unless it's a single-file script.

JSON format:
{
  "goal": "Create a Flask + React todo app",
  "steps": [
    {
      "step_number": 1,
      "action": "create_file",
      "target_file": "backend/main.py",
      "instruction": "Flask app entry point. Import routes from backend/routes.py"
    },
    {
      "step_number": 2,
      "action": "create_file",
      "target_file": "backend/models.py",
      "instruction": "SQLAlchemy Todo model with id, title, done fields"
    },
    {
      "step_number": 3,
      "action": "create_file",
      "target_file": "backend/routes.py",
      "instruction": "CRUD routes for Todo. Import model from backend/models.py"
    },
    {
      "step_number": 4,
      "action": "create_file",
      "target_file": "frontend/src/App.tsx",
      "instruction": "React app that fetches todos from backend API at localhost:5000"
    },
    {
      "step_number": 5,
      "action": "create_file",
      "target_file": "frontend/public/index.html",
      "instruction": "HTML entry point loading the React bundle"
    },
    {
      "step_number": 6,
      "action": "create_file",
      "target_file": "requirements.txt",
      "instruction": "Flask, flask-cors, sqlalchemy only"
    }
  ]
}"""


async def generate_plan(
    instruction: str,
    file_list: list[str],
    model: str,
    user_id: str,
    context_snippets: str = "",
    project_memory: str = "",
    target_file_content: str = "",
    max_retries: int = 3
) -> dict:
    """
    Returns a validated plan dict.
    Raises ValueError if all retries fail.

    Context priority (token-efficient):
      1. project_memory   — full YANTRIK_MEMORY.md (~300 tokens)
      2. target file      — full content of the file being touched
      3. other files      — names only
    """
    files_str = "\n".join(f"  - {f}" for f in file_list) if file_list else "  (no files yet)"

    parts = []
    if project_memory:
        parts.append(f"Project memory:\n{project_memory}")
    if target_file_content:
        parts.append(f"Target file content:\n{target_file_content}")
    parts.append(f"All workspace files:\n{files_str}")
    is_new_project = len(file_list) <= 1  # only YANTRIK_MEMORY.md or empty

    if is_new_project:
        project_hint = (
            "\nThis is a new project with no files yet. "
            "Use proper folder structure — do NOT create all files at root level."
        )
    else:
        # Show existing folder structure so agent continues the pattern
        folders = set()
        for f in file_list:
            if '/' in f:
                folders.add(f.split('/')[0])
        if folders:
            project_hint = f"\nExisting top-level folders: {', '.join(sorted(folders))}. Continue this structure."
        else:
            project_hint = ""

    parts.append(f"User instruction:\n{instruction}{project_hint}")

    base_prompt = "\n\n".join(parts)

    last_error = None
    for attempt in range(1, max_retries + 1):
        user_prompt = base_prompt
        if attempt > 1:
            user_prompt += f"\n\nAttempt {attempt} — previous parse error: {last_error}\nReturn ONLY valid JSON."

        try:
            raw = await call_llm(
                model_id=model,
                messages=[{"role": "user", "content": user_prompt}],
                system=PLAN_SYSTEM,
                user_id=user_id,
                max_tokens=4096,
                temperature=0.2,
            )
            raw = re.sub(r"```(?:json)?\n?", "", raw).replace("```", "").strip()
            plan = json.loads(raw)
            assert "goal"  in plan and isinstance(plan["goal"], str)
            assert "steps" in plan and isinstance(plan["steps"], list)
            for s in plan["steps"]:
                s["action"] = s.get("action", "").lower().strip()
                if s["action"] not in VALID_ACTIONS:
                    s["action"] = "explain"
            return plan
        except Exception as e:
            last_error = str(e)

    raise ValueError(f"Plan generation failed after {max_retries} attempts: {last_error}")


def _detect_language(filename: str) -> str:
    ext_map = {
        ".py": "python", ".ts": "typescript", ".tsx": "typescript",
        ".js": "javascript", ".jsx": "javascript", ".html": "html",
        ".css": "css", ".json": "json", ".md": "markdown",
        ".sh": "bash", ".yaml": "yaml", ".yml": "yaml",
        ".sql": "sql", ".rs": "rust", ".go": "go",
    }
    for ext, lang in ext_map.items():
        if filename.endswith(ext):
            return lang
    return "plaintext"


def _strip_markdown_fences(raw: str) -> str:
    raw = re.sub(r"```[\w]*\n?", "", raw)
    raw = raw.replace("```", "").strip()
    return raw


async def _generate_code(
    action: str,
    target_file: str,
    instruction: str,
    existing_content: str,
    model: str,
    user_id: str,
    created_files_context: dict[str, str] | None = None,
) -> str:
    lang = _detect_language(target_file)

    # Build context from already-created files in this job
    context_str = ""
    if created_files_context:
        snippets = []
        for fname, fcontent in list(created_files_context.items())[:5]:
            snippets.append(f"### {fname} (already created)\n{fcontent[:600]}")
        context_str = "\n\nOther files already created in this job:\n" + "\n\n".join(snippets)

    if action == "create_file":
        system = (
            f"You are an expert {lang} developer creating a file at path: {target_file}\n"
            f"Use the full path when writing import statements relative to project root.\n"
            f"For example, if this file is at backend/routes.py and it needs to import "
            f"from backend/models.py, use: from models import Todo (since they share the same folder).\n"
            f"Return ONLY valid {lang} code. No markdown fences. No explanations."
        )
        user   = f"File path: {target_file}\n\nInstruction:\n{instruction}{context_str}"
    else:
        truncated = existing_content[:MAX_FILE_CHARS]
        if len(existing_content) > MAX_FILE_CHARS:
            truncated += "\n\n# ... [file truncated — preserve all code below this point] ..."
        system = f"You are an expert {lang} developer. Modify the file as instructed. Return ONLY the complete updated file. No markdown fences. No explanations."
        user   = f"Filename: {target_file}\n\nCurrent content:\n{truncated}\n\nInstruction:\n{instruction}{context_str}"

    raw = await call_llm(
        model_id=model,
        messages=[{"role": "user", "content": user}],
        system=system,
        user_id=user_id,
        max_tokens=4096,
        temperature=0.2,
    )
    return _strip_markdown_fences(raw)


async def _self_correct(
    code: str,
    filename: str,
    instruction: str,
    error: str,
    model: str,
    user_id: str,
) -> str:
    lang   = _detect_language(filename)
    system = f"You are an expert {lang} developer. Fix the code based on the error. Return ONLY valid {lang} code."
    user   = (
        f"This code has an error:\n{code}\n\n"
        f"Error: {error}\n\n"
        f"Original instruction: {instruction}\n\n"
        f"Return the corrected code only."
    )
    raw = await call_llm(
        model_id=model,
        messages=[{"role": "user", "content": user}],
        system=system,
        user_id=user_id,
        max_tokens=4096,
        temperature=0.1,
    )
    return _strip_markdown_fences(raw)


def _validate_syntax(code: str, filename: str) -> Optional[str]:
    if not filename.endswith(".py"):
        return None
    try:
        ast.parse(code)
        return None
    except SyntaxError as e:
        return f"SyntaxError at line {e.lineno}: {e.msg}"


async def execute_plan(
    plan: dict,
    job_id: str,
    project_id: str,
    file_lookup: dict[str, dict],
    model: str,
    user_id: str,
    db,
    step_callback=None,
) -> list[dict]:
    """
    Execute each step in the plan sequentially.
    step_callback: async callable(step_result) — called immediately after each step
                   so the WebSocket broadcast fires one step at a time.
    """
    results = []
    created_in_job: dict[str, str] = {}  # filename → content for cross-file context

    for step in plan.get("steps", []):
        step_num    = step.get("step_number", 1)
        action      = step.get("action", "explain")
        target      = step.get("target_file", "")
        instruction = step.get("instruction", "")

        result = {
            "step_number": step_num,
            "action":      action,
            "target_file": target,
            "status":      "running",
            "output":      None,
            "diff_id":     None,
            "error":       None,
        }

        try:
            if action == "explain":
                file_info = file_lookup.get(target, {})
                context   = file_info.get("content", "")[:3000] if file_info else ""
                answer = await call_llm(
                    model_id=model,
                    messages=[{"role": "user", "content": f"File context:\n{context}\n\nQuestion:\n{instruction}"}],
                    system="You are an expert developer. Answer clearly and concisely.",
                    user_id=user_id,
                    max_tokens=1024,
                    temperature=0.5,
                )
                result["status"] = "done"
                result["output"] = answer

            elif action == "create_file":
                code = await _generate_code("create_file", target, instruction, "", model, user_id, created_files_context=created_in_job)
                syntax_err = _validate_syntax(code, target)
                if syntax_err:
                    code = await _self_correct(code, target, instruction, syntax_err, model, user_id)

                old_content    = ""
                diff_text      = generate_unified_diff(target, old_content, code)
                added, removed = count_changes(diff_text)
                risk           = score_risk(diff_text)
                diff_id        = str(uuid.uuid4())

                await db.execute(
                    """INSERT INTO pending_diffs
                       (id, job_id, project_id, file_id, filename,
                        old_content, new_content, diff_text,
                        lines_added, lines_removed, risk_level, status)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,'accepted')""",
                    (diff_id, job_id, project_id, None, target,
                     old_content, code, diff_text, added, removed, risk)
                )
                await db.commit()

                # Auto-apply: insert the new file into workspace_files immediately
                import uuid as _uuid
                new_file_id = str(_uuid.uuid4())
                lang = _detect_language(target)
                now = datetime.utcnow().isoformat()
                await db.execute(
                    "INSERT OR IGNORE INTO workspace_files (id, project_id, filename, content, language, created_by) VALUES (?,?,?,?,?,?)",
                    (new_file_id, project_id, target, code, lang, "agent")
                )
                await db.commit()
                # Update file_lookup so subsequent steps see this new file
                file_lookup[target] = {"id": new_file_id, "content": code, "language": lang}

                created_in_job[target] = code  # track for cross-file context
                result["status"]        = "done"
                result["diff_id"]       = diff_id
                result["new_content"]   = code
                result["output"]        = f"Created `{target}` (+{added} lines)"
                result["lines_added"]   = added
                result["lines_removed"] = removed
                result["risk_level"]    = risk

            elif action == "modify_file":
                file_info = file_lookup.get(target)
                if not file_info:
                    result["status"] = "error"
                    result["error"]  = f"File `{target}` not found in workspace. Create it first."
                    results.append(result)
                    if step_callback:
                        await step_callback(result)
                    continue

                old_content = file_info["content"]
                code = await _generate_code("modify_file", target, instruction, old_content, model, user_id, created_files_context=created_in_job)
                syntax_err = _validate_syntax(code, target)
                if syntax_err:
                    code = await _self_correct(code, target, instruction, syntax_err, model, user_id)

                diff_text      = generate_unified_diff(target, old_content, code)
                added, removed = count_changes(diff_text)
                risk           = score_risk(diff_text)
                diff_id        = str(uuid.uuid4())

                await db.execute(
                    """INSERT INTO pending_diffs
                       (id, job_id, project_id, file_id, filename,
                        old_content, new_content, diff_text,
                        lines_added, lines_removed, risk_level, status)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,'accepted')""",
                    (diff_id, job_id, project_id, file_info["id"], target,
                     old_content, code, diff_text, added, removed, risk)
                )
                await db.commit()

                # Auto-apply: update the file content immediately
                now = datetime.utcnow().isoformat()
                await db.execute(
                    "UPDATE workspace_files SET content=?, updated_at=? WHERE id=?",
                    (code, now, file_info["id"])
                )
                await db.commit()
                # Update file_lookup in-place so subsequent steps in this job see the new content
                file_lookup[target]["content"] = code

                result["status"]        = "done"
                result["diff_id"]       = diff_id
                result["new_content"]   = code
                result["output"]        = f"Updated `{target}` (+{added}/-{removed} lines)"
                result["lines_added"]   = added
                result["lines_removed"] = removed
                result["risk_level"]    = risk

        except Exception as e:
            result["status"] = "error"
            result["error"]  = str(e)

        results.append(result)

        # Broadcast each step result immediately as it completes
        if step_callback:
            await step_callback(result)

    return results
