"""
Central model registry.
tier: "free" | "byok" | "ollama"
provider: which API key provider is needed
"""

ALL_MODELS = [
    # ── Free (Groq) ────────────────────────────────────────────────
    {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B",  "provider": "groq",      "tier": "free"},
    {"id": "llama-3.1-8b-instant",    "name": "Llama 3.1 8B",   "provider": "groq",      "tier": "free"},
    {"id": "mixtral-8x7b-32768",      "name": "Mixtral 8x7B",   "provider": "groq",      "tier": "free"},
    {"id": "gemma2-9b-it",            "name": "Gemma 2 9B",     "provider": "groq",      "tier": "free"},

    # ── BYOK — OpenAI ──────────────────────────────────────────────
    {"id": "gpt-4o",                  "name": "GPT-4o",          "provider": "openai",    "tier": "byok"},
    {"id": "gpt-4o-mini",             "name": "GPT-4o Mini",     "provider": "openai",    "tier": "byok"},
    {"id": "gpt-4-turbo",             "name": "GPT-4 Turbo",     "provider": "openai",    "tier": "byok"},

    # ── BYOK — Anthropic ───────────────────────────────────────────
    {"id": "claude-opus-4-6",         "name": "Claude Opus 4.6", "provider": "anthropic", "tier": "byok"},
    {"id": "claude-sonnet-4-6",       "name": "Claude Sonnet 4.6","provider": "anthropic","tier": "byok"},
    {"id": "claude-haiku-4-5-20251001","name": "Claude Haiku 4.5","provider": "anthropic","tier": "byok"},

    # ── BYOK — Google ──────────────────────────────────────────────
    {"id": "gemini-1.5-pro",          "name": "Gemini 1.5 Pro",  "provider": "google",    "tier": "byok"},
    {"id": "gemini-1.5-flash",        "name": "Gemini 1.5 Flash","provider": "google",    "tier": "byok"},
    {"id": "gemini-2.0-flash",        "name": "Gemini 2.0 Flash","provider": "google",    "tier": "byok"},

    # ── Ollama (local) ─────────────────────────────────────────────
    {"id": "ollama/llama3",           "name": "Ollama: Llama 3", "provider": "ollama",    "tier": "ollama"},
    {"id": "ollama/mistral",          "name": "Ollama: Mistral", "provider": "ollama",    "tier": "ollama"},
    {"id": "ollama/codellama",        "name": "Ollama: CodeLlama","provider": "ollama",   "tier": "ollama"},
    {"id": "ollama/custom",           "name": "Ollama: Custom",  "provider": "ollama",    "tier": "ollama"},
]

MODEL_MAP = {m["id"]: m for m in ALL_MODELS}

def get_model_info(model_id: str) -> dict | None:
    return MODEL_MAP.get(model_id)

def get_provider(model_id: str) -> str:
    m = MODEL_MAP.get(model_id)
    return m["provider"] if m else "groq"

def get_tier(model_id: str) -> str:
    m = MODEL_MAP.get(model_id)
    return m["tier"] if m else "free"
