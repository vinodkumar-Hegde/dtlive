from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import WebSocket
from redis.asyncio import Redis

from .config import settings


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[int, set[WebSocket]] = defaultdict(set)
        self.lock = asyncio.Lock()

    async def connect(self, room_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self.lock:
            self.rooms[room_id].add(websocket)

    async def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        async with self.lock:
            self.rooms[room_id].discard(websocket)
            if not self.rooms[room_id]:
                self.rooms.pop(room_id, None)

    async def broadcast(self, room_id: int, payload: dict) -> None:
        dead: list[WebSocket] = []

        for websocket in list(self.rooms.get(room_id, set())):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)

        for websocket in dead:
            await self.disconnect(room_id, websocket)


manager = ConnectionManager()

redis_client: Redis | None = None
listener_task: asyncio.Task | None = None

_memory_users: dict[int, dict[int, dict]] = defaultdict(dict)
_memory_connections: dict[int, dict[int, int]] = defaultdict(dict)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_snapshot(records: list[dict]) -> dict:
    records = sorted(
        records,
        key=lambda item: (
            item.get("role") != "student",
            str(item.get("name", "")).lower(),
        ),
    )

    students = [
        item
        for item in records
        if item.get("role") == "student"
    ]

    return {
        "online_count": len(records),
        "student_count": len(students),
        "students": students,
    }


async def start_realtime() -> None:
    global redis_client, listener_task

    redis_client = Redis.from_url(
        settings.redis_url,
        decode_responses=True,
    )

    await redis_client.ping()
    listener_task = asyncio.create_task(_redis_listener())


async def stop_realtime() -> None:
    global listener_task, redis_client

    if listener_task:
        listener_task.cancel()

        try:
            await listener_task
        except asyncio.CancelledError:
            pass

    if redis_client:
        await redis_client.aclose()


async def _redis_listener() -> None:
    assert redis_client is not None

    pubsub = redis_client.pubsub()
    await pubsub.psubscribe("chat:room:*")

    try:
        async for item in pubsub.listen():
            if item.get("type") != "pmessage":
                continue

            channel = item["channel"]
            room_id = int(channel.rsplit(":", 1)[-1])
            payload = json.loads(item["data"])

            await manager.broadcast(room_id, payload)
    finally:
        await pubsub.aclose()


async def publish(room_id: int, payload: dict) -> None:
    if redis_client:
        try:
            await redis_client.publish(
                f"chat:room:{room_id}",
                json.dumps(payload),
            )
            return
        except Exception:
            pass

    await manager.broadcast(room_id, payload)


async def presence_snapshot(room_id: int) -> dict:
    if redis_client:
        connection_key = f"presence:room:{room_id}:connections"
        users_key = f"presence:room:{room_id}:users"

        counts = await redis_client.hgetall(connection_key)
        raw_users = await redis_client.hgetall(users_key)

        records: list[dict] = []
        stale_ids: list[str] = []

        for raw_user_id, raw_payload in raw_users.items():
            connection_count = int(
                counts.get(raw_user_id, "0") or "0"
            )

            if connection_count <= 0:
                stale_ids.append(raw_user_id)
                continue

            try:
                metadata = json.loads(raw_payload)
            except Exception:
                metadata = {
                    "id": int(raw_user_id),
                    "name": f"Student {raw_user_id}",
                    "role": "student",
                    "joined_at": None,
                }

            metadata["connections"] = connection_count
            records.append(metadata)

        if stale_ids:
            await redis_client.hdel(users_key, *stale_ids)
            await redis_client.hdel(connection_key, *stale_ids)

        return _build_snapshot(records)

    users = _memory_users.get(room_id, {})
    counts = _memory_connections.get(room_id, {})

    records = []

    for user_id, metadata in users.items():
        connection_count = counts.get(user_id, 0)

        if connection_count <= 0:
            continue

        record = dict(metadata)
        record["connections"] = connection_count
        records.append(record)

    return _build_snapshot(records)


async def presence_join(
    room_id: int,
    user_id: int,
    name: str,
    role: str,
) -> dict:
    metadata = {
        "id": user_id,
        "name": name,
        "role": role,
        "joined_at": _now_iso(),
    }

    if redis_client:
        connection_key = f"presence:room:{room_id}:connections"
        users_key = f"presence:room:{room_id}:users"
        field = str(user_id)

        existing = await redis_client.hget(users_key, field)

        if existing:
            try:
                previous = json.loads(existing)

                if previous.get("joined_at"):
                    metadata["joined_at"] = previous["joined_at"]
            except Exception:
                pass

        await redis_client.hset(
            users_key,
            field,
            json.dumps(metadata),
        )

        await redis_client.hincrby(
            connection_key,
            field,
            1,
        )

        await redis_client.expire(users_key, 43200)
        await redis_client.expire(connection_key, 43200)

        return await presence_snapshot(room_id)

    counts = _memory_connections[room_id]

    counts[user_id] = counts.get(user_id, 0) + 1

    if user_id not in _memory_users[room_id]:
        _memory_users[room_id][user_id] = metadata

    return await presence_snapshot(room_id)


async def presence_leave(
    room_id: int,
    user_id: int,
) -> dict:
    if redis_client:
        connection_key = f"presence:room:{room_id}:connections"
        users_key = f"presence:room:{room_id}:users"
        field = str(user_id)

        current = int(
            await redis_client.hget(connection_key, field)
            or "0"
        )

        if current <= 1:
            await redis_client.hdel(connection_key, field)
            await redis_client.hdel(users_key, field)
        else:
            await redis_client.hincrby(
                connection_key,
                field,
                -1,
            )

        return await presence_snapshot(room_id)

    counts = _memory_connections.get(room_id, {})
    current = counts.get(user_id, 0)

    if current <= 1:
        counts.pop(user_id, None)
        _memory_users.get(room_id, {}).pop(user_id, None)
    else:
        counts[user_id] = current - 1

    if not counts:
        _memory_connections.pop(room_id, None)
        _memory_users.pop(room_id, None)

    return await presence_snapshot(room_id)


async def enforce_slow_mode(
    room_id: int,
    user_id: int,
    seconds: int,
) -> bool:
    if seconds <= 0 or not redis_client:
        return True

    key = f"slowmode:{room_id}:{user_id}"

    return bool(
        await redis_client.set(
            key,
            "1",
            ex=seconds,
            nx=True,
        )
    )
