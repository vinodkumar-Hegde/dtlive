from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

ALGORITHM = "HS256"


def create_access_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "name": user.name,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = decode_access_token(authorization[7:])
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User is not active")
    return user


def get_ws_user(
    token: str = Query(...),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_access_token(token)
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User is not active")
    return user


def require_moderator(user: User) -> None:
    if user.role not in {"faculty", "moderator", "admin"}:
        raise HTTPException(status_code=403, detail="Moderator permission required")
