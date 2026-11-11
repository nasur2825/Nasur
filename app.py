import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from google import genai
except ImportError:
    genai = None


# ============================================================
# NASUR CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
INSTRUCTIONS_FILE = BASE_DIR / "instructions.json"


def load_instructions() -> dict:
    """Load NASUR AI instructions safely."""
    try:
        with open(INSTRUCTIONS_FILE, "r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        return {
            "app": {
                "name": "NASUR",
                "version": "1.0.0"
            }
        }
    except json.JSONDecodeError:
        raise RuntimeError("instructions.json contains invalid JSON.")


NASUR_INSTRUCTIONS = load_instructions()


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="NASUR Personal Industrial HSE Operating System",
    version=NASUR_INSTRUCTIONS.get("app", {}).get("version", "1.0.0")
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"]
)


# ============================================================
# DATA MODELS
# ============================================================

class ChatRequest(BaseModel):
    message: str = Field(
        min_length=1,
        max_length=10000,
        description="User message for NASUR AI"
    )
    career_level: Optional[str] = "HSE Assistant"
    industry: Optional[str] = "Construction"
    region: Optional[str] = "Gulf"


class ChatResponse(BaseModel):
    success: bool
    response: str
    source: str


# ============================================================
# SYSTEM PROMPT BUILDER
# ============================================================

def build_system_prompt(
    career_level: str,
    industry: str,
    region: str
) -> str:
    communication = NASUR_INSTRUCTIONS.get("communication", {})
    boundaries = NASUR_INSTRUCTIONS.get("safetyBoundaries", {})

    return f"""
You are NASUR, a Personal Industrial HSE Operating System assistant.

CURRENT USER PROFILE:
Career Level: {career_level}
Industry: {industry}
Region: {region}

COMMUNICATION STYLE:
Primary style: {communication.get("primaryStyle", "Simple English")}
Technical terms: {communication.get("technicalTerms", "")}

TEACHING METHOD:
{json.dumps(communication.get("teachingMethod", []), ensure_ascii=False)}

SAFETY BOUNDARIES:
{json.dumps(boundaries.get("important", []), ensure_ascii=False)}

IMPORTANT:
- Give practical and easy-to-understand explanations.
- Clearly distinguish general learning guidance from site-specific requirements.
- Do not claim to replace a competent person, permit issuer, engineer, supervisor or emergency authority.
- For high-risk work, remind the user to follow approved site procedures and competent-person requirements.
- Explain technical HSE terms clearly.
"""


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health_check():
    api_key_available = bool(os.getenv("GEMINI_API_KEY"))

    return {
        "status": "healthy",
        "app": NASUR_INSTRUCTIONS.get("app", {}).get("name", "NASUR"),
        "version": NASUR_INSTRUCTIONS.get("app", {}).get("version", "1.0.0"),
        "gemini_configured": api_key_available
    }


# ============================================================
# CHAT API
# ============================================================

@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "GEMINI_API_KEY is not configured on the server. "
                "Add it securely as an environment secret."
            )
        )

    if genai is None:
        raise HTTPException(
            status_code=500,
            detail="google-genai package is not installed."
        )

    try:
        client = genai.Client(api_key=api_key)

        system_prompt = build_system_prompt(
            request.career_level or "HSE Assistant",
            request.industry or "Construction",
            request.region or "Gulf"
        )

        full_prompt = (
            f"{system_prompt}\n\n"
            f"USER QUESTION:\n{request.message}"
        )

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=full_prompt
        )

        answer = getattr(response, "text", None)

        if not answer:
            answer = (
                "NASUR AI did not return a text response. "
                "Please try again."
            )

        return ChatResponse(
            success=True,
            response=answer,
            source="NASUR Gemini AI"
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"NASUR AI service error: {str(error)}"
        )


# ============================================================
# LOCAL DEVELOPMENT ENTRY POINT
# ============================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True
    )