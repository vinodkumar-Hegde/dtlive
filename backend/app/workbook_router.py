from __future__ import annotations

import os
import re
import secrets
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .auth import get_current_user
from .db import get_db
from .workbook_models import Workbook, WorkbookPage

router = APIRouter(tags=["workbooks"])

STORAGE_ROOT = Path(
    os.getenv("WORKBOOK_STORAGE_ROOT", "/app/storage/workbooks")
).resolve()
MAX_PDF_BYTES = int(os.getenv("WORKBOOK_MAX_BYTES", str(100 * 1024 * 1024)))
ALLOWED_UPLOAD_ROLES = {"faculty", "moderator", "admin"}


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value or "workbook.pdf")
    cleaned = cleaned.strip("-.") or "workbook.pdf"
    return cleaned[:180]


def _require_upload_role(user: models.User) -> None:
    if user.role not in ALLOWED_UPLOAD_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only Faculty, Moderator, or Admin can upload workbooks",
        )


def _ensure_room(room_id: int, db: Session) -> models.ChatRoom:
    room = db.get(models.ChatRoom, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _public_file_url(request: Request, workbook: Workbook) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/workbooks/{workbook.id}/file?key={workbook.access_key}"


def _serialize_workbook(request: Request, item: Workbook) -> dict:
    return {
        "id": item.id,
        "room_id": item.room_id,
        "title": item.title,
        "description": item.description,
        "original_filename": item.original_filename,
        "mime_type": item.mime_type,
        "file_size": item.file_size,
        "page_count": item.page_count,
        "extracted_page_count": item.extracted_page_count,
        "status": item.status,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "file_url": _public_file_url(request, item),
        "pages_url": f"{str(request.base_url).rstrip('/')}/api/workbooks/{item.id}/pages",
    }


@router.get("/api/workbooks/health")
def workbook_health():
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    return {
        "status": "ok",
        "service": "workbook-processing",
        "extractor": "pypdf",
        "storage_ready": STORAGE_ROOT.is_dir(),
        "max_pdf_mb": MAX_PDF_BYTES // (1024 * 1024),
    }


@router.post("/api/rooms/{room_id}/workbooks/upload")
def upload_workbook(
    room_id: int,
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(default=""),
    description: str = Form(default=""),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_upload_role(user)
    _ensure_room(room_id, db)

    original_name = _safe_filename(file.filename or "workbook.pdf")
    content_type = (file.content_type or "").lower()
    if not original_name.lower().endswith(".pdf") and content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF workbooks are supported")

    room_dir = STORAGE_ROOT / str(room_id)
    room_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{original_name}"
    destination = room_dir / stored_name

    total_bytes = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_PDF_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Workbook is larger than {MAX_PDF_BYTES // (1024 * 1024)} MB",
                    )
                output.write(chunk)

        try:
            reader = PdfReader(str(destination), strict=False)
            if reader.is_encrypted:
                try:
                    reader.decrypt("")
                except Exception as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Password-protected PDF is not supported: {exc}",
                    )
            page_count = len(reader.pages)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid or unreadable PDF: {exc}")

        workbook = Workbook(
            room_id=room_id,
            created_by_id=user.id,
            title=(title.strip() or Path(original_name).stem)[:240],
            description=description.strip(),
            original_filename=original_name,
            stored_filename=stored_name,
            storage_path=str(destination),
            mime_type="application/pdf",
            file_size=total_bytes,
            page_count=page_count,
            status="processing",
            access_key=secrets.token_urlsafe(32),
        )
        db.add(workbook)
        db.flush()

        extracted_count = 0
        for page_index, page in enumerate(reader.pages):
            try:
                page_text = (page.extract_text() or "").strip()
            except Exception:
                page_text = ""
            if page_text:
                extracted_count += 1
            db.add(
                WorkbookPage(
                    workbook_id=workbook.id,
                    page_number=page_index + 1,
                    text=page_text,
                    char_count=len(page_text),
                )
            )

        workbook.extracted_page_count = extracted_count
        workbook.status = "ready" if extracted_count else "needs_ocr"
        db.commit()
        db.refresh(workbook)
        return _serialize_workbook(request, workbook)

    except HTTPException:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    except Exception as exc:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Workbook processing failed: {exc}")
    finally:
        file.file.close()


@router.get("/api/rooms/{room_id}/workbooks")
def list_workbooks(
    room_id: int,
    request: Request,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_room(room_id, db)
    items = db.scalars(
        select(Workbook)
        .where(Workbook.room_id == room_id)
        .order_by(Workbook.created_at.desc(), Workbook.id.desc())
    ).all()
    return [_serialize_workbook(request, item) for item in items]


@router.get("/api/workbooks/{workbook_id}/pages")
def get_workbook_pages(
    workbook_id: int,
    page: int | None = Query(default=None, ge=1),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    workbook = db.get(Workbook, workbook_id)
    if not workbook:
        raise HTTPException(status_code=404, detail="Workbook not found")

    query = select(WorkbookPage).where(WorkbookPage.workbook_id == workbook_id)
    if page is not None:
        query = query.where(WorkbookPage.page_number == page)
    pages = db.scalars(query.order_by(WorkbookPage.page_number)).all()

    return {
        "workbook_id": workbook.id,
        "title": workbook.title,
        "page_count": workbook.page_count,
        "status": workbook.status,
        "pages": [
            {
                "page_number": item.page_number,
                "text": item.text,
                "char_count": item.char_count,
            }
            for item in pages
        ],
    }


@router.get("/api/workbooks/{workbook_id}/file")
def open_workbook_file(
    workbook_id: int,
    key: str = Query(min_length=20),
    db: Session = Depends(get_db),
):
    workbook = db.get(Workbook, workbook_id)
    if not workbook or not secrets.compare_digest(workbook.access_key, key):
        raise HTTPException(status_code=404, detail="Workbook not found")

    path = Path(workbook.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Workbook file is unavailable")

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=workbook.original_filename,
        content_disposition_type="inline",
    )


@router.delete("/api/workbooks/{workbook_id}")
def delete_workbook(
    workbook_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_upload_role(user)
    workbook = db.get(Workbook, workbook_id)
    if not workbook:
        raise HTTPException(status_code=404, detail="Workbook not found")

    path = Path(workbook.storage_path)
    db.delete(workbook)
    db.commit()
    path.unlink(missing_ok=True)

    room_dir = path.parent
    if room_dir.exists() and not any(room_dir.iterdir()):
        shutil.rmtree(room_dir, ignore_errors=True)

    return {"ok": True, "workbook_id": workbook_id}
