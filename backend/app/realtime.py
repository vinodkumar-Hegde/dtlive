from __future__ import annotations

import asyncio
import json
from collections import defaultdict

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


async def start_realtime() -> None:
    global redis_client, listener_task
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
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
            await redis_client.publish(f"chat:room:{room_id}", json.dumps(payload))
            return
        except Exception:
            pass
    await manager.broadcast(room_id, payload)


async def presence_increment(room_id: int) -> int:
    if not redis_client:
        return len(manager.rooms.get(room_id, set()))
    return int(await redis_client.incr(f"presence:room:{room_id}"))


async def presence_decrement(room_id: int) -> int:
    if not redis_client:
        return len(manager.rooms.get(room_id, set()))
    key = f"presence:room:{room_id}"
    value = int(await redis_client.decr(key))
    if value < 0:
        await redis_client.set(key, 0)
        return 0
    return value


async def enforce_slow_mode(room_id: int, user_id: int, seconds: int) -> bool:
    if seconds <= 0 or not redis_client:
        return True
    key = f"slowmode:{room_id}:{user_id}"
    return bool(await redis_client.set(key, "1", ex=seconds, nx=True))
