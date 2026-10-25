"""Shared FastAPI dependencies. Tests swap these with app.dependency_overrides."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.engine import get_session
from core.memory.embedder import Embedder, get_embedder

SessionDep = Annotated[AsyncSession, Depends(get_session)]
EmbedderDep = Annotated[Embedder, Depends(get_embedder)]
