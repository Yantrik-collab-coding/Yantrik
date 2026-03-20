"""
Universal LLM caller.
Routes to Groq / OpenAI / Anthropic / Google / Ollama based on model_id.
Retrieves user's encrypted API key from DB when needed.
"""
import aiosqlite
from core.database import DB_PATH
from core.encryption import decrypt
from core.models import get_provider

async def _get_user_key(user_id: str, provider: str) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT key_value FROM user_api_keys WHERE user_id=? AND provider=?",
            (user_id, provider)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    try:
        return decrypt(row["key_value"])
    except Exception:
        return None

async def _get_ollama_url(user_id: str) -> str:
    url = await _get_user_key(user_id, "ollama_url")
    return url or "http://localhost:11434"

async def call_llm(
    model_id: str,
    messages: list,
    system: str,
    user_id: str,
    max_tokens: int = 1024,
    temperature: float = 0.7,
) -> str:
    provider = get_provider(model_id)

    # ── Groq ──────────────────────────────────────────────────────
    if provider == "groq":
        from groq import AsyncGroq
        # Users must supply their own Groq key — no server-side key is used
        key = await _get_user_key(user_id, "groq")
        if not key:
            return "⚠️ No Groq API key found. Add your free Groq key in Profile → API Keys (console.groq.com)."
        client = AsyncGroq(api_key=key)
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[{"role": "system", "content": system}] + messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content

    # ── OpenAI ────────────────────────────────────────────────────
    elif provider == "openai":
        from openai import AsyncOpenAI
        key = await _get_user_key(user_id, "openai")
        if not key:
            return "⚠️ No OpenAI API key found. Add it in Profile → API Keys."
        client = AsyncOpenAI(api_key=key)
        resp = await client.chat.completions.create(
            model=model_id,
            messages=[{"role": "system", "content": system}] + messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content

    # ── Anthropic ─────────────────────────────────────────────────
    elif provider == "anthropic":
        import anthropic
        key = await _get_user_key(user_id, "anthropic")
        if not key:
            return "⚠️ No Anthropic API key found. Add it in Profile → API Keys."
        client = anthropic.AsyncAnthropic(api_key=key)
        resp = await client.messages.create(
            model=model_id,
            system=system,
            messages=messages,
            max_tokens=max_tokens,
        )
        return resp.content[0].text

    # ── Google Gemini ─────────────────────────────────────────────
    elif provider == "google":
        import google.generativeai as genai
        key = await _get_user_key(user_id, "google")
        if not key:
            return "⚠️ No Google API key found. Add it in Profile → API Keys."
        genai.configure(api_key=key)
        model_name = model_id.replace("gemini-", "models/gemini-")
        model = genai.GenerativeModel(model_id, system_instruction=system)
        # Convert messages to Gemini format
        gemini_msgs = []
        for m in messages:
            role = "user" if m["role"] == "user" else "model"
            gemini_msgs.append({"role": role, "parts": [m["content"]]})
        resp = await model.generate_content_async(gemini_msgs)
        return resp.text

    # ── Ollama ────────────────────────────────────────────────────
    elif provider == "ollama":
        import httpx
        base_url = await _get_ollama_url(user_id)
        ollama_model = model_id.replace("ollama/", "")
        # Build prompt
        full_messages = [{"role": "system", "content": system}] + messages
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{base_url}/api/chat", json={
                "model": ollama_model,
                "messages": full_messages,
                "stream": False,
            })
            data = resp.json()
            return data.get("message", {}).get("content", "⚠️ Empty response from Ollama")

    return f"⚠️ Unknown provider: {provider}"
