from pydantic import BaseModel, ConfigDict, Field


class DemoLoginIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    role: str = "student"


class RoomCreate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    description: str | None = None
    live_session_id: str | None = None
    slow_mode_seconds: int = Field(default=0, ge=0, le=3600)


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=5000)
    reply_to_id: int | None = None
    attachment_url: str | None = None
    attachment_type: str | None = None


class MessageUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=20)


class ReadIn(BaseModel):
    message_id: int | None = None


class SlowModeIn(BaseModel):
    seconds: int = Field(ge=0, le=3600)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class VideoSDKTokenIn(BaseModel):
    session_name: str = Field(min_length=2, max_length=150)

class LiveKitTokenIn(BaseModel):
    room_name: str = Field(min_length=2, max_length=150)

class WorkbookResourceIn(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    url: str = Field(min_length=3, max_length=1200)
    description: str = Field(default="", max_length=300)


class LiveSessionSetupIn(BaseModel):
    session_title: str = Field(
        default="DocTutorials Live Class",
        min_length=2,
        max_length=220,
    )
    course: str = Field(min_length=2, max_length=140)
    subject: str = Field(min_length=2, max_length=140)
    topic: str = Field(min_length=2, max_length=220)
    scheduled_at: str | None = Field(default=None, max_length=80)
    duration_minutes: int = Field(default=60, ge=15, le=480)
    overview: str = Field(default="", max_length=3000)
    objectives: list[str] = Field(default_factory=list, max_length=12)
    workbooks: list[WorkbookResourceIn] = Field(
        default_factory=list,
        max_length=12,
    )
