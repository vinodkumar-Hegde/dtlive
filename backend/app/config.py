from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://dt_chat_admin:dt_chat_password@localhost:55436/dt_live_chat"
    redis_url: str = "redis://localhost:6389/0"
    jwt_secret: str = "replace-this-with-a-long-random-secret"
    cors_origins: str = "http://localhost:5192"
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    livekit_node_ip: str = "127.0.0.1"
    livekit_public_url: str = ""
    zoom_video_sdk_key: str = ""
    zoom_video_sdk_secret: str = ""
    zoom_video_session_password: str = ""
    faculty_email: str = "faculty@doctutorials.com"
    faculty_password: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


settings = Settings()
