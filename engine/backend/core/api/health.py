"""GET /api/v1/health: is the backend up, and can it reach the database and pgvector?"""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from core.api.deps import SessionDep
from core.api.errors import Problem

router = APIRouter(tags=["health"])


class HealthOut(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
    pgvector: str
    apps: list[str]


@router.get(
    "/health",
    summary="Check the backend and the database",
    response_model=HealthOut,
    responses={503: {"description": "The database or pgvector isn't ready"}},
)
async def health(request: Request, session: SessionDep) -> HealthOut:
    try:
        version = await session.scalar(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        )
    except (DBAPIError, OSError) as error:
        raise Problem(
            503, "The database can't be reached", "Start it with: docker compose up -d"
        ) from error
    if version is None:
        raise Problem(503, "pgvector isn't turned on", "Run: uv run engine migrate")
    return HealthOut(
        status="ok",
        database="ok",
        pgvector=str(version),
        apps=[spec.name for spec in request.app.state.apps],
    )
