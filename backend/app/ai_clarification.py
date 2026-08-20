from __future__ import annotations

import asyncio
import json
import os
import re
import time
import urllib.request
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .auth import get_current_user
from .db import SessionLocal, get_db
from .workbook_models import Workbook, WorkbookPage

router = APIRouter(tags=["academic-ai"])

OLLAMA_BASE_URL = os.getenv(
    "OLLAMA_BASE_URL",
    "http://host.docker.internal:11434",
).rstrip("/")

WORKBOOK_MODELS = [
    os.getenv("AI_WORKBOOK_MODEL", "qwen3.5:9b"),
    "qwen3:8b",
    "qwen2.5:7b",
    "gemma3:4b",
]

BALANCED_MODELS = [
    os.getenv("AI_GENERAL_FALLBACK_MODEL", "qwen3.5:9b"),
    "qwen3:8b",
    "qwen2.5:7b",
    "gemma3:4b",
]

DEEP_MODELS = [
    os.getenv("AI_MEDICAL_FALLBACK_MODEL", "medgemma:27b"),
    "qwen3.5:9b",
    "qwen3:8b",
    "qwen2.5:7b",
]

MAX_CONTEXT_CHARS = int(
    os.getenv("AI_MAX_CONTEXT_CHARS", "16000")
)

MIN_GROUNDING_SCORE = int(
    os.getenv("AI_MIN_GROUNDING_SCORE", "8")
)

MODEL_TIMEOUT_SECONDS = int(
    os.getenv("AI_MODEL_TIMEOUT_SECONDS", "120")
)


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=5000)


class TutorAskIn(BaseModel):
    room_id: int
    question: str = Field(min_length=2, max_length=4000)
    quality_mode: Literal["balanced", "deep"] = "balanced"
    history: list[HistoryItem] = Field(default_factory=list)


@dataclass
class Evidence:
    title: str
    page: int
    text: str
    score: int
    matches: int


def is_academic_question(value: str | None) -> bool:
    text = re.sub(r"\s+", " ", value or "").strip()
    return len(text) >= 6


async def schedule_student_ai_clarification(
    room_id: int,
    question_message_id: int,
    student_name: str,
) -> None:
    # AI is private. Never publish it into Live Mode.
    return None


def _terms(question: str) -> set[str]:
    ignored = {
        "what", "why", "how", "which", "when", "where",
        "explain", "define", "difference", "between",
        "about", "please", "with", "from", "that",
    }

    return {
        token
        for token in re.findall(
            r"[a-zA-Z0-9][a-zA-Z0-9_-]{2,}",
            question.lower(),
        )
        if token not in ignored
    }


def _evidence(room_id: int, question: str) -> list[Evidence]:
    terms = _terms(question)

    with SessionLocal() as db:
        rows = db.execute(
            select(WorkbookPage, Workbook)
            .join(
                Workbook,
                Workbook.id == WorkbookPage.workbook_id,
            )
            .where(
                Workbook.room_id == room_id,
                WorkbookPage.char_count > 0,
            )
            .order_by(
                Workbook.created_at.desc(),
                WorkbookPage.page_number.asc(),
            )
        ).all()

    ranked: list[Evidence] = []

    for page, workbook in rows:
        text = re.sub(r"\s+", " ", page.text or "").strip()
        lowered = text.lower()

        exact = {term for term in terms if term in lowered}
        score = len(exact) * 4

        ranked.append(
            Evidence(
                title=workbook.title,
                page=page.page_number,
                text=text,
                score=score,
                matches=len(exact),
            )
        )

    ranked.sort(
        key=lambda item: (
            item.score,
            item.matches,
            -item.page,
        ),
        reverse=True,
    )

    return ranked[:6]


def _strong(items: list[Evidence]) -> bool:
    return bool(
        items
        and items[0].score >= MIN_GROUNDING_SCORE
        and items[0].matches >= 2
    )


def _context(items: list[Evidence]) -> tuple[str, list[dict]]:
    remaining = MAX_CONTEXT_CHARS
    chunks: list[str] = []
    sources: list[dict] = []

    for item in items:
        excerpt = item.text[:remaining]
        if not excerpt:
            break

        label = f"{item.title}, page {item.page}"
        chunks.append(f"[{label}]\n{excerpt}")
        sources.append(
            {
                "type": "workbook",
                "title": item.title,
                "page_number": item.page,
                "label": label,
            }
        )

        remaining -= len(excerpt)
        if remaining <= 0:
            break

    return "\n\n".join(chunks), sources


def _installed() -> list[str]:
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/tags",
        method="GET",
    )

    with urllib.request.urlopen(
        request,
        timeout=15,
    ) as response:
        payload = json.loads(response.read().decode())

    return [
        str(item.get("name") or item.get("model"))
        for item in payload.get("models", [])
        if item.get("name") or item.get("model")
    ]


def _available(candidates: list[str]) -> list[str]:
    installed = set(_installed())
    result: list[str] = []

    for model in candidates:
        if model in installed and model not in result:
            result.append(model)

    return result


def _call_model(
    model: str,
    system_prompt: str,
    question: str,
    history: list[HistoryItem],
    timeout: int,
) -> dict:
    messages = [
        {
            "role": "system",
            "content": system_prompt,
        }
    ]

    for item in history[-6:]:
        messages.append(
            {
                "role": item.role,
                "content": item.content[:3000],
            }
        )

    messages.append(
        {
            "role": "user",
            "content": question,
        }
    )

    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "stream": False,
            "think": False,
            "keep_alive": "5m",
            "options": {
                "temperature": 0.12,
                "top_p": 0.85,
                "num_ctx": 8192,
                "num_predict": 500,
            },
        }
    ).encode()

    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    started = time.monotonic()

    with urllib.request.urlopen(
        request,
        timeout=timeout,
    ) as response:
        result = json.loads(response.read().decode())

    answer = str(
        (result.get("message") or {}).get("content") or ""
    ).strip()

    answer = re.sub(
        r"<think>.*?</think>",
        "",
        answer,
        flags=re.S | re.I,
    ).strip()

    if not answer:
        raise RuntimeError(
            f"{model} returned no final answer text"
        )

    return {
        "answer": answer,
        "model": model,
        "latency_seconds": round(
            time.monotonic() - started,
            2,
        ),
    }


def _generate(
    candidates: list[str],
    prompt: str,
    question: str,
    history: list[HistoryItem],
) -> tuple[dict, list[str]]:
    models_to_try = _available(candidates)

    if not models_to_try:
        raise RuntimeError(
            "No configured local AI model is installed"
        )

    failures: list[str] = []

    for index, model in enumerate(models_to_try):
        try:
            return (
                _call_model(
                    model,
                    prompt,
                    question,
                    history,
                    MODEL_TIMEOUT_SECONDS
                    if index == 0
                    else 90,
                ),
                failures,
            )
        except Exception as exc:
            failures.append(
                f"{model}: {type(exc).__name__}: {exc}"
            )

    raise RuntimeError(
        "All local models failed. " + " | ".join(failures)
    )


def _workbook_prompt(context: str, labels: str) -> str:
    return f'''
You are the private DocTutorials AI Tutor.

Answer only from the uploaded workbook evidence.
Do not add unsupported facts.
Do not expose hidden reasoning.
Do not provide patient-specific diagnosis or prescriptions.
Give a direct answer followed by a concise mechanism or key point.

Workbook evidence:
{context}

End with:
Workbook source: {labels}
'''.strip()


def _general_prompt() -> str:
    return '''
You are the private DocTutorials AI Tutor for medical students.

The answer was not found strongly enough in the uploaded workbook.
Give a careful academic explanation from general model knowledge.

Rules:
- Use standard medical terminology.
- Explain the mechanism or differentiating point.
- Do not invent citations, page numbers, guidelines, or Faculty statements.
- Do not provide patient-specific diagnosis, prescriptions, or dosage.
- State uncertainty when the question is ambiguous.
- Do not expose hidden reasoning.

End with:
Source type: General model knowledge — not found in the uploaded workbook.
'''.strip()


@router.post("/api/ai/tutor/ask")
async def ask_private_tutor(
    payload: TutorAskIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "student":
        raise HTTPException(
            status_code=403,
            detail="AI Tutor is currently available to students",
        )

    room = db.get(models.ChatRoom, payload.room_id)
    if room is None:
        raise HTTPException(
            status_code=404,
            detail="Classroom not found",
        )

    question = re.sub(
        r"\s+",
        " ",
        payload.question,
    ).strip()

    items = await asyncio.to_thread(
        _evidence,
        payload.room_id,
        question,
    )

    try:
        if _strong(items):
            context, sources = _context(items)
            labels = "; ".join(
                item["label"] for item in sources[:3]
            )

            result, failures = await asyncio.to_thread(
                _generate,
                WORKBOOK_MODELS,
                _workbook_prompt(context, labels),
                question,
                payload.history,
            )

            return {
                **result,
                "source_type": "workbook",
                "sources": sources[:3],
                "confidence": "grounded",
                "fallbacks": failures,
                "private": True,
            }

        candidates = (
            DEEP_MODELS
            if payload.quality_mode == "deep"
            else BALANCED_MODELS
        )

        result, failures = await asyncio.to_thread(
            _generate,
            candidates,
            _general_prompt(),
            question,
            payload.history,
        )

        return {
            **result,
            "source_type": "general_model",
            "sources": [],
            "confidence": "model_generated",
            "fallbacks": failures,
            "private": True,
        }

    except Exception as exc:
        print(
            "Private AI Tutor failed:",
            type(exc).__name__,
            repr(exc),
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "The local AI could not complete the answer. "
                f"{type(exc).__name__}: {exc}"
            ),
        ) from exc


@router.get("/api/ai/health")
def ai_health():
    installed = _installed()

    return {
        "status": "ok",
        "service": "private-ai-tutor",
        "ollama": "reachable",
        "installed_models": installed,
        "balanced_candidates": _available(BALANCED_MODELS),
        "deep_candidates": _available(DEEP_MODELS),
        "workbook_candidates": _available(WORKBOOK_MODELS),
        "thinking_disabled": True,
        "automatic_public_ai": False,
    }
