from __future__ import annotations

import os

import boto3
from botocore.config import Config


AWS_REGION = os.getenv("AWS_REGION", "us-west-2")

BEDROCK_MODEL_ID = os.getenv(
    "BEDROCK_MODEL_ID",
    "us.amazon.nova-2-lite-v1:0",
)

_client = None


def _client_instance():
    global _client

    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=AWS_REGION,
            config=Config(
                connect_timeout=5,
                read_timeout=120,
                retries={
                    "max_attempts": 3,
                    "mode": "standard",
                },
            ),
        )

    return _client


def stream_from_bedrock(
    messages: list[dict],
    quality_mode: str,
):
    system_text: list[str] = []
    conversation: list[dict] = []

    for item in messages:
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()

        if not content:
            continue

        if role == "system":
            system_text.append(content)
            continue

        if role not in {"user", "assistant"}:
            continue

        conversation.append(
            {
                "role": role,
                "content": [
                    {
                        "text": content,
                    }
                ],
            }
        )

    if not conversation:
        raise RuntimeError(
            "No conversation content supplied to Bedrock"
        )

    max_tokens = (
        360
        if quality_mode == "deep"
        else 220
    )

    request = {
        "modelId": BEDROCK_MODEL_ID,
        "messages": conversation,
        "inferenceConfig": {
            "maxTokens": max_tokens,
            "temperature": 0.14,
            "topP": 0.82,
        },
    }

    if system_text:
        request["system"] = [
            {
                "text": "\n\n".join(system_text),
            }
        ]

    response = _client_instance().converse_stream(
        **request
    )

    stream = response.get("stream")

    if stream is None:
        raise RuntimeError(
            "Bedrock returned no response stream"
        )

    for event in stream:
        delta_event = event.get(
            "contentBlockDelta"
        )

        if delta_event:
            delta = delta_event.get("delta") or {}
            text = delta.get("text")

            if text:
                yield str(text)

        error_types = (
            "internalServerException",
            "modelStreamErrorException",
            "throttlingException",
            "validationException",
            "serviceUnavailableException",
        )

        for error_type in error_types:
            if error_type in event:
                raise RuntimeError(
                    f"{error_type}: "
                    f"{event[error_type]}"
                )
