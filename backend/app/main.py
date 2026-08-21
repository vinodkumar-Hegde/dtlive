from __future__ import annotations

import asyncio
import hmac

import json

import uuid

from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload
from livekit import api as livekit_api

from . import models, schemas
from .ai_stream_router import router as ai_stream_router
from .ai_clarification import (
    is_academic_question,
    router as academic_ai_router,
    schedule_student_ai_clarification,
)
from .auth import create_access_token, get_current_user, get_ws_user, require_moderator
from .config import settings
from .db import Base, SessionLocal, engine, get_db
from .workbook_router import router as workbook_router
from .realtime import (
    enforce_slow_mode,
    manager,
    presence_decrement,
    presence_increment,
    publish,
    start_realtime,
    stop_realtime,
)



def _safe_json_list(value: str | None) -> list:
    if not value:
        return []
    try:
        result = json.loads(value)
        return result if isinstance(result, list) else []
    except (TypeError, ValueError):
        return []


def serialize_live_class_session(
    item: models.LiveClassSession | None,
    room: models.ChatRoom,
) -> dict:
    if item is None:
        return {
            "id": None,
            "room_id": room.id,
            "live_session_id": room.live_session_id,
            "session_title": room.title,
            "course": "",
            "subject": "",
            "topic": "",
            "faculty_name": "",
            "scheduled_at": None,
            "duration_minutes": 60,
            "overview": "",
            "objectives": [],
            "workbooks": [],
            "status": "draft",
            "started_at": None,
            "updated_at": None,
        }

    return {
        "id": item.id,
        "room_id": item.room_id,
        "live_session_id": room.live_session_id,
        "session_title": item.session_title,
        "course": item.course,
        "subject": item.subject,
        "topic": item.topic,
        "faculty_name": item.faculty_name,
        "scheduled_at": item.scheduled_at,
        "duration_minutes": item.duration_minutes,
        "overview": item.overview,
        "objectives": _safe_json_list(item.objectives_json),
        "workbooks": _safe_json_list(item.workbooks_json),
        "status": item.status,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }

def serialize_message(message: models.Message) -> dict:
    reaction_counter = Counter(reaction.emoji for reaction in message.reactions)
    reply = None
    if message.reply_to:
        reply = {
            "id": message.reply_to.id,
            "body": "Message deleted" if message.reply_to.deleted_at else message.reply_to.body[:160],
            "author_name": message.reply_to.author.name if message.reply_to.author else "Unknown",
        }
    return {
        "id": message.id,
        "room_id": message.room_id,
        "body": "Message deleted" if message.deleted_at else message.body,
        "reply_to": reply,
        "attachment_url": None if message.deleted_at else message.attachment_url,
        "attachment_type": None if message.deleted_at else message.attachment_type,
        "is_pinned": message.is_pinned,
        "is_deleted": bool(message.deleted_at),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "created_at": message.created_at.isoformat(),
        "author": {
            "id": message.author.id,
            "name": message.author.name,
            "role": message.author.role,
            "avatar_url": message.author.avatar_url,
        },
        "reactions": [{"emoji": emoji, "count": count} for emoji, count in reaction_counter.items()],
    }


def message_query():
    return (
        select(models.Message)
        .options(
            joinedload(models.Message.author),
            joinedload(models.Message.reply_to).joinedload(models.Message.author),
            selectinload(models.Message.reactions),
        )
    )


def seed_defaults() -> None:
    with SessionLocal() as db:
        existing = db.scalar(select(func.count(models.ChatRoom.id)))
        if existing:
            return
        db.add_all(
            [
                models.ChatRoom(
                    title="Live Session – General",
                    description="Main student discussion room",
                    live_session_id="demo-live-001",
                    slow_mode_seconds=2,
                ),
                models.ChatRoom(
                    title="Faculty Q&A",
                    description="Questions selected for faculty response",
                    live_session_id="demo-live-001",
                    slow_mode_seconds=5,
                ),
                models.ChatRoom(
                    title="Announcements",
                    description="Important updates from the DocTutorials team",
                    room_type="announcement",
                    is_locked=True,
                ),
            ]
        )
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_defaults()
    try:
        await start_realtime()
    except Exception as exc:
        print(f"Redis realtime unavailable; using single-instance mode: {exc}")
    yield
    await stop_realtime()


app = FastAPI(title="DocTutorials Live Chat API", lifespan=lifespan)
app.include_router(workbook_router)
app.include_router(ai_stream_router)
app.include_router(academic_ai_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "doctutorials-live-chat"}


def _login_response(user: models.User) -> dict:
    return {
        "access_token": create_access_token(user),
        "user": {
            "id": user.id,
            "name": user.name,
            "role": user.role,
        },
    }


@app.post("/api/auth/student-login")
def student_login(
    payload: schemas.StudentLoginIn,
    db: Session = Depends(get_db),
):
    name = payload.name.strip()

    if name.lower() == settings.faculty_email.strip().lower():
        raise HTTPException(
            status_code=400,
            detail="Use Faculty Login for this account",
        )

    user = db.scalars(
        select(models.User)
        .where(
            func.lower(models.User.name) == name.lower(),
            models.User.role == "student",
        )
        .order_by(models.User.id.asc())
        .limit(1)
    ).first()

    if not user:
        user = models.User(
            name=name,
            role="student",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return _login_response(user)


@app.post("/api/auth/faculty-login")
def faculty_login(
    payload: schemas.FacultyLoginIn,
    db: Session = Depends(get_db),
):
    configured_email = settings.faculty_email.strip().lower()
    configured_password = settings.faculty_password

    if not configured_password:
        raise HTTPException(
            status_code=503,
            detail="Faculty authentication is not configured",
        )

    supplied_email = payload.email.strip().lower()

    email_ok = hmac.compare_digest(
        supplied_email,
        configured_email,
    )

    password_ok = hmac.compare_digest(
        payload.password,
        configured_password,
    )

    if not email_ok or not password_ok:
        raise HTTPException(
            status_code=401,
            detail="Invalid faculty email or password",
        )

    user = db.scalars(
        select(models.User)
        .where(
            func.lower(models.User.name) == configured_email,
            models.User.role == "faculty",
        )
        .order_by(models.User.id.asc())
        .limit(1)
    ).first()

    if not user:
        user = models.User(
            name=configured_email,
            role="faculty",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return _login_response(user)


@app.post("/api/auth/demo-login")
def demo_login(
    payload: schemas.DemoLoginIn,
    db: Session = Depends(get_db),
):
    # Legacy compatibility: never permit role escalation.
    if payload.role.lower() != "student":
        raise HTTPException(
            status_code=403,
            detail="Role selection has been disabled",
        )

    return student_login(
        schemas.StudentLoginIn(name=payload.name),
        db,
    )


@app.get("/api/rooms")
def list_rooms(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rooms = db.scalars(select(models.ChatRoom).order_by(models.ChatRoom.created_at)).all()
    result = []
    for room in rooms:
        member = db.scalar(
            select(models.RoomMember).where(
                models.RoomMember.room_id == room.id,
                models.RoomMember.user_id == user.id,
            )
        )
        last_read = member.last_read_message_id if member else 0
        unread = db.scalar(
            select(func.count(models.Message.id)).where(
                models.Message.room_id == room.id,
                models.Message.id > (last_read or 0),
                models.Message.user_id != user.id,
                models.Message.deleted_at.is_(None),
            )
        )
        latest = db.scalar(
            message_query()
            .where(models.Message.room_id == room.id)
            .order_by(models.Message.id.desc())
            .limit(1)
        )
        result.append(
            {
                "id": room.id,
                "title": room.title,
                "description": room.description,
                "live_session_id": room.live_session_id,
                "room_type": room.room_type,
                "slow_mode_seconds": room.slow_mode_seconds,
                "is_locked": room.is_locked,
                "unread_count": unread or 0,
                "last_message": serialize_message(latest) if latest else None,
            }
        )
    return result


@app.post("/api/rooms")
def create_room(
    payload: schemas.RoomCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_moderator(user)
    room = models.ChatRoom(**payload.model_dump())
    db.add(room)
    db.commit()
    db.refresh(room)
    return {"id": room.id, "title": room.title}



@app.get("/api/rooms/{room_id}/session")
def get_live_class_session(
    room_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    item = db.scalar(
        select(models.LiveClassSession).where(
            models.LiveClassSession.room_id == room_id
        )
    )
    return serialize_live_class_session(item, room)


@app.put("/api/rooms/{room_id}/session")
async def save_live_class_session(
    room_id: int,
    payload: schemas.LiveSessionSetupIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "faculty":
        raise HTTPException(
            status_code=403,
            detail="Only Faculty can configure the live class",
        )

    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    item = db.scalar(
        select(models.LiveClassSession).where(
            models.LiveClassSession.room_id == room_id
        )
    )

    if item is None:
        item = models.LiveClassSession(room_id=room_id)
        db.add(item)

    item.session_title = payload.session_title.strip()
    item.course = payload.course.strip()
    item.subject = payload.subject.strip()
    item.topic = payload.topic.strip()
    item.faculty_name = user.name
    item.scheduled_at = payload.scheduled_at or None
    item.duration_minutes = payload.duration_minutes
    item.overview = payload.overview.strip()
    item.objectives_json = json.dumps(
        [value.strip() for value in payload.objectives if value.strip()]
    )
    item.workbooks_json = json.dumps(
        [resource.model_dump() for resource in payload.workbooks]
    )

    if item.status != "live":
        item.status = "ready"

    db.commit()
    db.refresh(item)

    result = serialize_live_class_session(item, room)
    await publish(
        room_id,
        {
            "type": "session_updated",
            "session": result,
        },
    )
    return result


@app.post("/api/rooms/{room_id}/session/start")
async def start_live_class_session(
    room_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "faculty":
        raise HTTPException(
            status_code=403,
            detail="Only Faculty can start the live class",
        )

    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    item = db.scalar(
        select(models.LiveClassSession).where(
            models.LiveClassSession.room_id == room_id
        )
    )

    if item is None or not all([item.course, item.subject, item.topic]):
        raise HTTPException(
            status_code=400,
            detail="Complete Course, Subject, and Topic before starting",
        )

    item.status = "live"
    item.started_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    result = serialize_live_class_session(item, room)
    await publish(
        room_id,
        {
            "type": "session_updated",
            "session": result,
        },
    )
    return result


@app.post("/api/rooms/{room_id}/session/end")
async def end_live_class_session(
    room_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "faculty":
        raise HTTPException(
            status_code=403,
            detail="Only Faculty can end the live class",
        )

    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    item = db.scalar(
        select(models.LiveClassSession).where(
            models.LiveClassSession.room_id == room_id
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Session setup not found")

    item.status = "ended"
    db.commit()
    db.refresh(item)

    result = serialize_live_class_session(item, room)
    await publish(
        room_id,
        {
            "type": "session_updated",
            "session": result,
        },
    )
    return result

@app.get("/api/rooms/{room_id}/messages")
def list_messages(
    room_id: int,
    before: int | None = Query(default=None),
    limit: int = Query(default=60, ge=1, le=100),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    query = message_query().where(models.Message.room_id == room_id)
    if before:
        query = query.where(models.Message.id < before)
    messages = db.scalars(query.order_by(models.Message.id.desc()).limit(limit)).unique().all()
    return [serialize_message(message) for message in reversed(messages)]


@app.get("/api/rooms/{room_id}/search")
def search_messages(
    room_id: int,
    q: str = Query(min_length=2, max_length=200),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    terms = [term.strip() for term in q.split() if term.strip()]
    conditions = [models.Message.body.ilike(f"%{term}%") for term in terms]
    query = (
        message_query()
        .where(
            models.Message.room_id == room_id,
            models.Message.deleted_at.is_(None),
            or_(*conditions),
        )
        .order_by(models.Message.id.desc())
        .limit(100)
    )
    return [serialize_message(message) for message in db.scalars(query).unique().all()]


@app.post("/api/rooms/{room_id}/messages")
async def create_message(
    room_id: int,
    payload: schemas.MessageCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.is_locked and user.role not in {"faculty", "moderator", "admin"}:
        raise HTTPException(status_code=403, detail="Only moderators can post in this room")
    if not payload.body.strip() and not payload.attachment_url:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if user.role == "student":
        permitted = await enforce_slow_mode(room_id, user.id, room.slow_mode_seconds)
        if not permitted:
            raise HTTPException(
                status_code=429,
                detail=f"Slow mode is active. Wait {room.slow_mode_seconds} seconds.",
            )
    if payload.reply_to_id:
        reply = db.get(models.Message, payload.reply_to_id)
        if not reply or reply.room_id != room_id:
            raise HTTPException(status_code=400, detail="Invalid reply target")
    message = models.Message(
        room_id=room_id,
        user_id=user.id,
        body=payload.body.strip(),
        reply_to_id=payload.reply_to_id,
        attachment_url=payload.attachment_url,
        attachment_type=payload.attachment_type,
    )
    db.add(message)
    db.commit()
    message = db.scalar(message_query().where(models.Message.id == message.id))
    event = {"type": "message_created", "message": serialize_message(message)}
    await publish(room_id, event)

    return event["message"]


@app.patch("/api/messages/{message_id}")
async def update_message(
    message_id: int,
    payload: schemas.MessageUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = db.get(models.Message, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.user_id != user.id and user.role not in {"moderator", "admin"}:
        raise HTTPException(status_code=403, detail="Cannot edit this message")
    if message.deleted_at:
        raise HTTPException(status_code=400, detail="Deleted message cannot be edited")
    message.body = payload.body.strip()
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    message = db.scalar(message_query().where(models.Message.id == message.id))
    event = {"type": "message_updated", "message": serialize_message(message)}
    await publish(message.room_id, event)
    return event["message"]


@app.delete("/api/messages/{message_id}")
async def delete_message(
    message_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = db.get(models.Message, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message.user_id != user.id and user.role not in {"moderator", "admin"}:
        raise HTTPException(status_code=403, detail="Cannot delete this message")
    message.deleted_at = datetime.now(timezone.utc)
    message.body = ""
    message.attachment_url = None
    db.commit()
    message = db.scalar(message_query().where(models.Message.id == message.id))
    event = {"type": "message_deleted", "message": serialize_message(message)}
    await publish(message.room_id, event)
    return {"ok": True}


@app.post("/api/messages/{message_id}/reactions")
async def toggle_reaction(
    message_id: int,
    payload: schemas.ReactionIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = db.get(models.Message, message_id)
    if not message or message.deleted_at:
        raise HTTPException(status_code=404, detail="Message not found")
    existing = db.scalar(
        select(models.Reaction).where(
            models.Reaction.message_id == message_id,
            models.Reaction.user_id == user.id,
            models.Reaction.emoji == payload.emoji,
        )
    )
    if existing:
        db.delete(existing)
    else:
        db.add(models.Reaction(message_id=message_id, user_id=user.id, emoji=payload.emoji))
    db.commit()
    message = db.scalar(message_query().where(models.Message.id == message_id))
    event = {"type": "reaction_updated", "message": serialize_message(message)}
    await publish(message.room_id, event)
    return event["message"]


@app.post("/api/messages/{message_id}/pin")
async def toggle_pin(
    message_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_moderator(user)
    message = db.get(models.Message, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    message.is_pinned = not message.is_pinned
    db.commit()
    message = db.scalar(message_query().where(models.Message.id == message_id))
    event = {"type": "message_updated", "message": serialize_message(message)}
    await publish(message.room_id, event)
    return event["message"]


@app.post("/api/rooms/{room_id}/read")
def mark_read(
    room_id: int,
    payload: schemas.ReadIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    latest_id = payload.message_id or db.scalar(
        select(func.max(models.Message.id)).where(models.Message.room_id == room_id)
    )
    member = db.scalar(
        select(models.RoomMember).where(
            models.RoomMember.room_id == room_id,
            models.RoomMember.user_id == user.id,
        )
    )
    if not member:
        member = models.RoomMember(room_id=room_id, user_id=user.id)
        db.add(member)
    member.last_read_message_id = latest_id
    db.commit()
    return {"ok": True, "last_read_message_id": latest_id}


@app.patch("/api/rooms/{room_id}/slow-mode")
async def update_slow_mode(
    room_id: int,
    payload: schemas.SlowModeIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_moderator(user)
    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    room.slow_mode_seconds = payload.seconds
    db.commit()
    await publish(
        room_id,
        {"type": "room_updated", "room": {"id": room.id, "slow_mode_seconds": room.slow_mode_seconds}},
    )
    return {"id": room.id, "slow_mode_seconds": room.slow_mode_seconds}


@app.websocket("/ws/rooms/{room_id}")
async def room_socket(
    websocket: WebSocket,
    room_id: int,
    user: models.User = Depends(get_ws_user),
):
    await manager.connect(room_id, websocket)
    online_count = await presence_increment(room_id)
    await publish(
        room_id,
        {
            "type": "presence",
            "room_id": room_id,
            "online_count": online_count,
            "user": {"id": user.id, "name": user.name},
        },
    )
    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")
            if event_type == "typing":
                await publish(
                    room_id,
                    {
                        "type": "typing",
                        "room_id": room_id,
                        "is_typing": bool(data.get("is_typing")),
                        "user": {"id": user.id, "name": user.name},
                    },
                )
            elif event_type == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room_id, websocket)
        online_count = await presence_decrement(room_id)
        await publish(
            room_id,
            {
                "type": "presence",
                "room_id": room_id,
                "online_count": online_count,
                "user": {"id": user.id, "name": user.name},
            },
        )

@app.post("/api/livekit/token")
def create_livekit_token(
    payload: schemas.LiveKitTokenIn,
    request: Request,
    user: models.User = Depends(get_current_user),
):
    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise HTTPException(
            status_code=503,
            detail="LiveKit credentials are not configured",
        )

    room_name = payload.room_name.strip()

    # Faculty is the only publishing role.
    can_broadcast = user.role == "faculty"

    # Moderators and admins can retain room-management permission without
    # receiving camera, microphone, or screen-share publishing rights.
    can_moderate = user.role in {"faculty", "moderator", "admin"}

    publish_sources = (
        ["camera", "microphone", "screen_share", "screen_share_audio"]
        if can_broadcast
        else []
    )

    participant_identity = f"dt-{user.id}-{uuid.uuid4().hex[:10]}"

    participant_token = (
        livekit_api.AccessToken(
            settings.livekit_api_key,
            settings.livekit_api_secret,
        )
        .with_identity(participant_identity)
        .with_name(user.name)
        .with_grants(
            livekit_api.VideoGrants(
                room_join=True,
                room=room_name,
                room_admin=can_moderate,
                can_publish=can_broadcast,
                can_subscribe=True,
                can_publish_data=False,
                can_publish_sources=publish_sources,
            )
        )
        .to_jwt()
    )

    if settings.livekit_public_url.strip():
        server_url = settings.livekit_public_url.strip()
    else:
        forwarded_proto = request.headers.get("x-forwarded-proto", "")
        forwarded_host = request.headers.get("x-forwarded-host", "")
        request_host = forwarded_host or request.headers.get("host", "localhost")
        hostname = request_host.rsplit(":", 1)[0]
        secure = forwarded_proto.lower() == "https" or request.url.scheme == "https"
        protocol = "wss" if secure else "ws"
        server_url = f"{protocol}://{hostname}:7880"

    return {
        "participant_token": participant_token,
        "server_url": server_url,
        "room_name": room_name,
        "participant_name": user.name,
        "role": user.role,
        "can_broadcast": can_broadcast,
        "viewer_only": not can_broadcast,
    }
