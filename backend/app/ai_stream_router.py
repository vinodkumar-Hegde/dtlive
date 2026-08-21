from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .auth import get_current_user
from .db import SessionLocal, get_db
from .workbook_models import Workbook, WorkbookPage
from .bedrock_provider import (
    BEDROCK_MODEL_ID,
    stream_from_bedrock,
)

router = APIRouter(tags=["private-ai-stream"])

AI_PROVIDER = os.getenv(
    "AI_PROVIDER",
    "ollama",
).strip().lower()

OLLAMA_BASE_URL = os.getenv(
    "OLLAMA_BASE_URL",
    "http://host.docker.internal:11434",
).rstrip("/")

FAST_MODEL_CANDIDATES = [
    os.getenv("AI_FAST_MODEL", "qwen3.5:9b"),
    "qwen2.5:7b",
    "qwen3:8b",
    "gemma3:4b",
]

MAX_CONTEXT_CHARS = max(
    5000,
    int(os.getenv("AI_FAST_CONTEXT_CHARS", "10000")),
)


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class StreamAskIn(BaseModel):
    room_id: int
    question: str = Field(min_length=2, max_length=3000)
    quality_mode: Literal["balanced", "deep"] = "balanced"
    history: list[HistoryItem] = Field(default_factory=list)


def _json_line(payload: dict) -> bytes:
    return (
        json.dumps(payload, ensure_ascii=False) + "\n"
    ).encode("utf-8")


def _question_terms(question: str) -> set[str]:
    ignored = {
        "what",
        "why",
        "how",
        "which",
        "when",
        "where",
        "explain",
        "define",
        "difference",
        "between",
        "about",
        "please",
        "with",
        "from",
        "that",
        "this",
        "does",
        "could",
        "would",
    }

    return {
        token
        for token in re.findall(
            r"[a-zA-Z0-9][a-zA-Z0-9_-]{2,}",
            question.lower(),
        )
        if token not in ignored
    }


def _workbook_context(
    room_id: int,
    question: str,
) -> tuple[str, list[dict], bool]:
    terms = _question_terms(question)

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

    ranked: list[tuple[int, int, object, object]] = []

    for page, workbook in rows:
        text = re.sub(
            r"\s+",
            " ",
            page.text or "",
        ).strip()

        lowered = text.lower()
        matches = {
            term for term in terms if term in lowered
        }

        score = len(matches) * 4

        ranked.append(
            (
                score,
                len(matches),
                page,
                workbook,
            )
        )

    ranked.sort(
        key=lambda item: (
            item[0],
            item[1],
            -item[2].page_number,
        ),
        reverse=True,
    )

    top = ranked[:5]
    strong = bool(
        top
        and top[0][0] >= 8
        and top[0][1] >= 2
    )

    if not strong:
        return "", [], False

    remaining = MAX_CONTEXT_CHARS
    chunks: list[str] = []
    sources: list[dict] = []

    for score, matches, page, workbook in top:
        if score <= 0:
            continue

        excerpt = re.sub(
            r"\s+",
            " ",
            page.text or "",
        ).strip()[:remaining]

        if not excerpt:
            continue

        label = f"{workbook.title}, page {page.page_number}"

        chunks.append(f"[{label}]\n{excerpt}")
        sources.append(
            {
                "type": "workbook",
                "title": workbook.title,
                "page_number": page.page_number,
                "label": label,
            }
        )

        remaining -= len(excerpt)

        if remaining <= 0:
            break

    return "\n\n".join(chunks), sources, True


def _installed_models() -> list[str]:
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/tags",
        method="GET",
    )

    with urllib.request.urlopen(
        request,
        timeout=12,
    ) as response:
        payload = json.loads(response.read().decode())

    return [
        str(item.get("name") or item.get("model"))
        for item in payload.get("models", [])
        if item.get("name") or item.get("model")
    ]


def _available_candidates() -> list[str]:
    installed = set(_installed_models())
    result: list[str] = []

    for model in FAST_MODEL_CANDIDATES:
        if (
            model
            and model in installed
            and model not in result
        ):
            result.append(model)

    return result


def _system_prompt(
    context: str,
    sources: list[dict],
    grounded: bool,
    quality_mode: str,
) -> str:
    bullet_limit = (
        "Use 3 to 5 short dash bullets."
        if quality_mode == "deep"
        else "Use 2 to 3 short dash bullets."
    )

    format_rules = f"""
Required response format:
Direct answer: one clear sentence.

- {bullet_limit}
- Put only the most important academic terms in **bold**.
- Add Key point: only when an exam distinction or common confusion matters.
- Never return one dense paragraph.
- Do not use a markdown table.
""".strip()

    if grounded:
        source_labels = "; ".join(
            item["label"] for item in sources[:3]
        )

        return f"""
You are the private DocTutorials AI Tutor.

Answer the student's academic question from the workbook evidence below.

Accuracy rules:
- Use only facts supported by the supplied workbook evidence.
- If the evidence does not fully answer the question, say so clearly.
- Use accurate terminology and plain language.
- Do not invent facts, citations, page numbers, or Faculty statements.
- Do not repeat the student's question.
- Do not expose hidden reasoning.
- Do not provide patient-specific diagnosis, prescription, or dosage.

{format_rules}

Workbook evidence:
{context}

End with exactly:
Workbook source: {source_labels}
""".strip()

    return f"""
You are the private DocTutorials AI Tutor.

Answer academic questions accurately across medicine, science,
and general education.

Accuracy rules:
- First understand the likely meaning of the question.
- For medical questions, use standard medical terminology.
- For general questions, answer normally without forcing a medical format.
- When wording is ambiguous, state the likely interpretation in one short phrase.
- Do not invent citations, workbook pages, Faculty statements, or guidelines.
- State uncertainty when the model cannot confirm a fact.
- Do not expose hidden reasoning.
- Do not provide patient-specific diagnosis, prescription, or dosage.

{format_rules}

End with exactly:
Source type: General academic model knowledge.
""".strip()


def _message_history(
    history: list[HistoryItem],
    system_prompt: str,
    question: str,
) -> list[dict]:
    messages = [
        {
            "role": "system",
            "content": system_prompt,
        }
    ]

    for item in history[-4:]:
        messages.append(
            {
                "role": item.role,
                "content": item.content[:2500],
            }
        )

    messages.append(
        {
            "role": "user",
            "content": question,
        }
    )

    return messages


def _stream_from_model(
    model: str,
    messages: list[dict],
    quality_mode: str,
):
    max_tokens = 360 if quality_mode == "deep" else 220

    payload = json.dumps(
        {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": False,
            "keep_alive": "30m",
            "options": {
                "temperature": 0.14,
                "top_p": 0.82,
                "repeat_penalty": 1.04,
                "num_ctx": 4096,
                "num_predict": max_tokens,
            },
        }
    ).encode()

    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=90,
    ) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8").strip()

            if not line:
                continue

            event = json.loads(line)
            message = event.get("message") or {}
            content = str(message.get("content") or "")

            if content:
                yield content

            if event.get("done"):
                return


@router.post("/api/ai/tutor/stream")
def stream_private_ai_tutor(
    payload: StreamAskIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "student":
        raise HTTPException(
            status_code=403,
            detail="AI Tutor is available to students",
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

    context, sources, grounded = _workbook_context(
        payload.room_id,
        question,
    )

    if AI_PROVIDER == "bedrock":
        candidates = [BEDROCK_MODEL_ID]
    else:
        candidates = _available_candidates()

        if not candidates:
            raise HTTPException(
                status_code=503,
                detail="No responsive local academic model is installed",
            )

    prompt = _system_prompt(
        context,
        sources,
        grounded,
        payload.quality_mode,
    )

    messages = _message_history(
        payload.history,
        prompt,
        question,
    )

    source_type = (
        "workbook"
        if grounded
        else "general_model"
    )

    def generate():
        failures: list[str] = []

        yield _json_line(
            {
                "type": "meta",
                "source_type": source_type,
                "sources": sources[:3],
                "quality_mode": payload.quality_mode,
            }
        )

        for model in candidates:
            started = time.monotonic()
            emitted = False

            try:
                if AI_PROVIDER == "bedrock":
                    stream = stream_from_bedrock(
                        messages,
                        payload.quality_mode,
                    )
                else:
                    stream = _stream_from_model(
                        model,
                        messages,
                        payload.quality_mode,
                    )

                for chunk in stream:
                    emitted = True

                    yield _json_line(
                        {
                            "type": "delta",
                            "content": chunk,
                        }
                    )

                if not emitted:
                    raise RuntimeError(
                        f"{model} returned no answer text"
                    )

                yield _json_line(
                    {
                        "type": "done",
                        "model": model,
                        "latency_seconds": round(
                            time.monotonic() - started,
                            2,
                        ),
                        "source_type": source_type,
                        "sources": sources[:3],
                        "confidence": (
                            "workbook_grounded"
                            if grounded
                            else "model_generated"
                        ),
                        "fallbacks": failures,
                    }
                )
                return

            except Exception as exc:
                failures.append(
                    f"{model}: {type(exc).__name__}: {exc}"
                )

        yield _json_line(
            {
                "type": "error",
                "detail": (
                    "AI Tutor provider failed. "
                    + " | ".join(failures)
                ),
            }
        )

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/ai/tutor/stream-health")
def stream_ai_health():
    if AI_PROVIDER == "bedrock":
        models_list = [BEDROCK_MODEL_ID]
    else:
        try:
            models_list = _available_candidates()
        except Exception:
            models_list = []

    return {
        "status": "ok",
        "service": "fast-streaming-ai-tutor",
        "provider": AI_PROVIDER,
        "models": models_list,
        "streaming": True,
        "context_tokens": 4096,
        "quick_output_tokens": 220,
        "detailed_output_tokens": 360,
    }
