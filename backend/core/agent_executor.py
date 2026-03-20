"""
agent_executor.py — Plan → Execute engine for Hive IDE
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


PLAN_SYSTEM = """You are an AI coding agent operating inside a shared team IDE called Hive.
Given a user instruction and the list of files in the workspace, produce a JSON execution plan.

Rules:
- Return ONLY valid JSON. No markdown. No explanation.
- Valid actions: "create_file", "modify_file", "explain"
- target_file MUST be an existing filename for modify_file/explain.
- For create_file, target_file is the new filename to create.
- Keep steps minimal and atomic.

JSON format:
{
  "goal": "short description",
  "steps": [
    {
      "step_number": 1,
      "action": "modify_file",
      "target_file": "main.py",
      "instruction": "Add a /health endpoint that returns {status: ok}"
    }
  ]
}"""


async def generate_plan(
    instruction: str,
    file_list: list[str],
    model: str,
    user_id: str,
    context_snippets: str = "",
    max_retries: int = 3
) -> dict:
    """
    Returns a validated plan dict.
    Raises ValueError if all retries fail.
    """
    files_str   = "\n".join(f"  - {f}" for f in file_list) if file_list else "  (no files yet)"
    context_str = f"\n\nRelevant file context:\n{context_snippets}" if context_snippets else ""
    base_prompt = (
        f"Workspace files:\n{files_str}{context_str}\n\n"
        f"User instruction:\n{instruction}"
    )

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
                max_tokens=1024,
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
) -> str:
    lang = _detect_language(target_file)

    if action == "create_file":
        system = f"You are an expert {lang} developer. Create a new file as instructed. Return ONLY valid {lang} code. No markdown fences. No explanations."
        user   = f"Filename: {target_file}\n\nInstruction:\n{instruction}"
    else:
        truncated = existing_content[:MAX_FILE_CHARS]
        if len(existing_content) > MAX_FILE_CHARS:
            truncated += "\n\n# ... [file truncated — preserve all code below this point] ..."
        system = f"You are an expert {lang} developer. Modify the file as instructed. Return ONLY the complete updated file. No markdown fences. No explanations."
        user   = f"Filename: {target_file}\n\nCurrent content:\n{truncated}\n\nInstruction:\n{instruction}"

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
                code = await _generate_code("create_file", target, instruction, "", model, user_id)
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
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')""",
                    (diff_id, job_id, project_id, None, target,
                     old_content, code, diff_text, added, removed, risk)
                )
                await db.commit()

                result["status"]        = "pending_review"
                result["diff_id"]       = diff_id
                result["output"]        = f"Ready to create `{target}` (+{added} lines) — risk: {risk}"
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
                code = await _generate_code("modify_file", target, instruction, old_content, model, user_id)
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
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')""",
                    (diff_id, job_id, project_id, file_info["id"], target,
                     old_content, code, diff_text, added, removed, risk)
                )
                await db.commit()

                result["status"]        = "pending_review"
                result["diff_id"]       = diff_id
                result["output"]        = f"Ready to modify `{target}` (+{added}/-{removed} lines) — risk: {risk}"
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
