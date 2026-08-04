from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "chat_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    role: Mapped[str] = mapped_column(String(30), default="student", index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    messages: Mapped[list["Message"]] = relationship(back_populates="author")


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    live_session_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    room_type: Mapped[str] = mapped_column(String(30), default="live")
    slow_mode_seconds: Mapped[int] = mapped_column(Integer, default=0)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RoomMember(Base):
    __tablename__ = "chat_room_members"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("chat_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("chat_users.id", ondelete="CASCADE"), index=True)
    last_read_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_messages_room_created", "room_id", "created_at"),
        Index("ix_messages_search", "room_id", "body"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("chat_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("chat_users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text, default="")
    reply_to_id: Mapped[int | None] = mapped_column(ForeignKey("chat_messages.id"), nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(800), nullable=True)
    attachment_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    author: Mapped[User] = relationship(back_populates="messages")
    reply_to: Mapped["Message | None"] = relationship(remote_side=[id])
    reactions: Mapped[list["Reaction"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )


class Reaction(Base):
    __tablename__ = "chat_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_user_emoji"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("chat_users.id", ondelete="CASCADE"), index=True)
    emoji: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    message: Mapped[Message] = relationship(back_populates="reactions")

class LiveClassSession(Base):
    __tablename__ = "live_class_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    session_title: Mapped[str] = mapped_column(
        String(220),
        default="DocTutorials Live Class",
    )
    course: Mapped[str] = mapped_column(String(140), default="")
    subject: Mapped[str] = mapped_column(String(140), default="")
    topic: Mapped[str] = mapped_column(String(220), default="")
    faculty_name: Mapped[str] = mapped_column(String(140), default="")
    scheduled_at: Mapped[str | None] = mapped_column(String(80), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    overview: Mapped[str] = mapped_column(Text, default="")
    objectives_json: Mapped[str] = mapped_column(Text, default="[]")
    workbooks_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
