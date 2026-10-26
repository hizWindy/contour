"""Turns text into numbers with FastEmbed, on this computer. No text leaves the machine.

The model downloads once (to engine/backend/.cache/fastembed) and loads on first use.
FastEmbed blocks while it works, so the async methods run it in a thread.
"""

import asyncio
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

from core.config import get_settings
from core.memory.models import EMBEDDING_DIM


class Embedder:
    def __init__(self, model_name: str, cache_dir: Path, threads: int | None = None) -> None:
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.threads = threads  # None: FastEmbed chooses
        self._model: Any = None
        self._lock = threading.Lock()

    def _load(self) -> Any:
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding

                self.cache_dir.mkdir(parents=True, exist_ok=True)
                self._model = TextEmbedding(
                    model_name=self.model_name,
                    cache_dir=str(self.cache_dir),
                    threads=self.threads,
                )
            return self._model

    def _check(self, vector: list[float]) -> list[float]:
        if len(vector) != EMBEDDING_DIM:
            raise ValueError(
                f"{self.model_name} gives {len(vector)} numbers, "
                f"but memory stores {EMBEDDING_DIM}. Changing the model needs a migration."
            )
        return vector

    def passages(self, texts: list[str]) -> list[list[float]]:
        """For text we store."""
        return [self._check(v.tolist()) for v in self._load().passage_embed(texts)]

    def query(self, text: str) -> list[float]:
        """For a search. Some models treat questions differently from stored text."""
        return self._check(next(iter(self._load().query_embed(text))).tolist())

    async def embed_passages(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self.passages, texts)

    async def embed_query(self, text: str) -> list[float]:
        return await asyncio.to_thread(self.query, text)


@lru_cache
def get_embedder() -> Embedder:
    settings = get_settings()
    return Embedder(
        settings.embedding_model, settings.embedding_cache_dir, settings.embedding_threads
    )
