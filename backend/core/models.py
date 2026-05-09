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

# ── Live model fetching support ──────────────────────────────────────────────

PROVIDER_BASE_URLS = {
    "groq":      "https://api.groq.com/openai/v1/models",
    "openai":    "https://api.openai.com/v1/models",
    "anthropic": None,   # Anthropic has no list endpoint — use hardcoded
    "google":    None,   # Google has no simple list endpoint — use hardcoded
}

# Curated display names for known model IDs (shown in dropdown)
MODEL_DISPLAY = {
    # Groq
    "llama-3.3-70b-versatile":      {"name": "Llama 3.3 70B",        "provider": "groq"},
    "llama-3.1-8b-instant":         {"name": "Llama 3.1 8B",         "provider": "groq"},
    "llama3-70b-8192":              {"name": "Llama 3 70B",          "provider": "groq"},
    "llama3-8b-8192":               {"name": "Llama 3 8B",           "provider": "groq"},
    "mixtral-8x7b-32768":           {"name": "Mixtral 8x7B",         "provider": "groq"},
    "gemma2-9b-it":                 {"name": "Gemma 2 9B",           "provider": "groq"},
    "deepseek-r1-distill-llama-70b":{"name": "DeepSeek R1 70B",      "provider": "groq"},
    "meta-llama/llama-4-scout-17b-16e-instruct": {"name": "Llama 4 Scout 17B", "provider": "groq"},
    "meta-llama/llama-4-maverick-17b-128e-instruct": {"name": "Llama 4 Maverick 17B", "provider": "groq"},
    # OpenAI
    "gpt-4o":                       {"name": "GPT-4o",               "provider": "openai"},
    "gpt-4o-mini":                  {"name": "GPT-4o Mini",          "provider": "openai"},
    "gpt-4-turbo":                  {"name": "GPT-4 Turbo",          "provider": "openai"},
    "gpt-4.1":                      {"name": "GPT-4.1",              "provider": "openai"},
    "gpt-4.1-mini":                 {"name": "GPT-4.1 Mini",         "provider": "openai"},
    "o3":                           {"name": "o3",                   "provider": "openai"},
    "o4-mini":                      {"name": "o4-mini",              "provider": "openai"},
    # Anthropic (hardcoded — no list API)
    "claude-opus-4-6":              {"name": "Claude Opus 4.6",      "provider": "anthropic"},
    "claude-sonnet-4-6":            {"name": "Claude Sonnet 4.6",    "provider": "anthropic"},
    "claude-haiku-4-5-20251001":    {"name": "Claude Haiku 4.5",     "provider": "anthropic"},
    # Google (hardcoded — no simple list API)
    "gemini-2.5-pro-preview-05-06": {"name": "Gemini 2.5 Pro",       "provider": "google"},
    "gemini-2.0-flash":             {"name": "Gemini 2.0 Flash",     "provider": "google"},
    "gemini-1.5-pro":               {"name": "Gemini 1.5 Pro",       "provider": "google"},
}

def get_provider(model_id: str) -> str:
    """Determine provider for any model ID — checks curated list, legacy map, then infers from prefix."""
    # Check MODEL_DISPLAY first (broader set)
    if model_id in MODEL_DISPLAY:
        return MODEL_DISPLAY[model_id]["provider"]
    # Check legacy MODEL_MAP
    m = MODEL_MAP.get(model_id)
    if m:
        return m["provider"]
    # Infer from prefix
    if model_id.startswith("ollama/"):   return "ollama"
    if model_id.startswith("gpt"):       return "openai"
    if model_id.startswith("claude"):    return "anthropic"
    if model_id.startswith("gemini"):    return "google"
    if model_id.startswith("o3") or model_id.startswith("o4"): return "openai"
    return "groq"  # default

def get_tier(model_id: str) -> str:
    m = MODEL_MAP.get(model_id)
    return m["tier"] if m else "free"

