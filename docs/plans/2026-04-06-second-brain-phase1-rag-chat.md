# Second Brain — Phase 1: RAG Chat Over Meetings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "chat with your meetings" page to Adamant — users ask questions and get cited answers drawn from their entire meeting history, all running locally.

**Architecture:** Inspired by [Karpathy's second-brain approach](https://x.com/karpathy/status/2039805659525644595): raw meeting data is first **compiled by the LLM into structured wiki articles** (`.md` files in `~/.adamant/wiki/`), with an auto-maintained `_index.md` that maps all meetings. Q&A reads the compiled wiki articles for context — not raw transcript chunks. Vector embeddings of raw chunks are also kept as a fast lookup to identify which wiki articles are relevant. A new `/memory` page in the frontend exposes a persistent chat UI.

**Tech Stack:** Python `ollama` (already installed, v0.5.2), `numpy` (new dep), FastAPI, React/Next.js, `lucide-react` (Brain icon)

> **Scope note:** This is Phase 1 of 3. Phase 2 (concept articles: people, projects, decisions) and Phase 3 (in-app wiki browser) are separate plans that build on this foundation.

---

## TLDR

Users get a "Memory" section in the Adamant sidebar. They can ask questions like "What did we decide about the API design in last week's architecture meeting?" and get a grounded, cited answer in a few seconds — entirely on-device. Behind the scenes, every saved meeting is compiled into a structured wiki article by the LLM. Those articles — not raw transcripts — are what the LLM reads when answering questions.

## Root Cause / Design Decisions

Adamant stores rich meeting content (transcripts, AI notes) but has no cross-meeting retrieval. Every answer requires manually hunting through individual meetings. This plan adds:

- **Wiki compilation**: after each meeting is saved, the configured LLM generates a structured `.md` wiki article for it (key decisions, action items, people, topics). Articles are stored in `~/.adamant/wiki/meetings/{meeting_id}.md`.
- **Auto-maintained index**: `~/.adamant/wiki/_index.md` is regenerated after every new article — a brief directory of all meetings that the LLM can scan to orient itself.
- **Vector search for routing**: raw transcript chunks are still embedded (Ollama `nomic-embed-text`) so we can identify *which* meeting wiki articles are relevant to a query without reading all of them.
- **Wiki-first Q&A**: at query time, vector search identifies the top-3 most relevant meeting IDs, then their full wiki articles are read as context (not raw chunks). Structured articles are higher-quality context than fragmented transcript pieces.
- **Citations**: each answer includes the meeting title(s) it drew from, with clickable links.
- **Auto-pipeline**: save transcript → embed chunks → compile wiki article → update index. No user action needed.

**Why compiled wiki articles over raw RAG?** Karpathy's insight: "I thought I had to reach for fancy RAG, but the LLM has been pretty good about auto-maintaining index files and brief summaries of all the documents and it reads all the important related data fairly easily at this small scale." Structured articles are more coherent, more information-dense, and easier for the LLM to reason over than a bag of fragmented transcript chunks.

**Why keep embeddings too?** The wiki approach works well at small scale (~100s of meetings). Embeddings give us fast routing to the right articles without reading all of them. The combination — embed to route, wiki to answer — is the right hybrid.

**Why SQLite + numpy instead of a dedicated vector DB?** Zero new dependencies beyond numpy. For a personal meeting recorder (~500 meetings × 15 chunks = 7,500 chunks), numpy cosine search takes ~50ms and needs ~22 MB. A dedicated vector store is the right upgrade beyond ~2,000 meetings.

**Free-form LLM vs pydantic-ai structured output:** The existing `TranscriptProcessor` uses pydantic-ai for structured JSON output (meeting summaries). Wiki compilation and chat both require free-form markdown/string responses. A new `llm_client.py` provides this without touching the existing pipeline.

## End Result

After this plan is complete:

- A **brain icon** appears in the Adamant sidebar, below the home button
- Clicking it opens the **Memory** page — a clean chat interface with a text input at the bottom
- The user types a question (e.g. "What action items came out of last Thursday's product review?") and presses Enter
- After ~2–5 seconds, a reply appears with the answer and **cited meeting cards** underneath — each card shows the meeting title and is a clickable link that opens that meeting's detail page
- When a new meeting is saved, it is automatically compiled into a structured wiki article (key decisions, action items, people, topics) and the global index is updated — no user action needed
- A **"Re-compile wiki"** button on the Memory page triggers full recompilation of all meetings
- Every answer is grounded in the compiled wiki articles, not raw transcript fragments — answers are coherent and well-structured

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/requirements.txt` | Modify | Add `numpy` |
| `backend/app/db.py` | Modify | Add `memory_chunks` table + 4 CRUD methods |
| `backend/app/embeddings.py` | Create | Ollama embedding calls + numpy cosine search |
| `backend/app/memory_indexer.py` | Create | Chunk + embed meetings, store in DB |
| `backend/app/wiki_compiler.py` | Create | LLM compiles meeting → structured `.md` article + updates `_index.md` |
| `backend/app/llm_client.py` | Create | Free-form LLM chat across all providers |
| `backend/app/memory_chat.py` | Create | Q&A: embed query → find relevant meeting IDs → read wiki articles → LLM → citations |
| `backend/app/main.py` | Modify | Add 4 `/api/memory/*` endpoints + auto-pipeline hook |
| `backend/tests/test_embeddings.py` | Create | Tests for embedding service + cosine search |
| `backend/tests/test_memory_indexer.py` | Create | Tests for indexer |
| `backend/tests/test_wiki_compiler.py` | Create | Tests for wiki article compilation |
| `backend/tests/test_memory_chat.py` | Create | Tests for Q&A pipeline |
| `frontend/src/app/memory/page.tsx` | Create | Memory page (layout + wires up MemoryChat) |
| `frontend/src/components/MemoryChat.tsx` | Create | Chat messages list + input + citations UI |
| `frontend/src/components/Sidebar/index.tsx` | Modify | Add Brain icon + Memory nav item |

---

## Tasks

---

### Task 1: Add numpy to requirements and create test scaffold

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: Add numpy to requirements.txt**

Open `backend/requirements.txt` and add one line:

```
numpy==1.26.4
```

Final file content:

```
pydantic-ai==0.2.15
pydantic==2.11.5
pandas==2.2.3
devtools==0.12.2
python-dotenv==1.1.0
fastapi==0.115.9
uvicorn==0.34.0
python-multipart==0.0.20
aiosqlite==0.21.0
ollama==0.5.2
numpy==1.26.4
```

- [ ] **Step 2: Create tests directory**

```bash
mkdir -p backend/tests
touch backend/tests/__init__.py
```

- [ ] **Step 3: Create conftest.py with shared fixtures**

Create `backend/tests/conftest.py`:

```python
import pytest
import asyncio
import os
import sys

# Make the app directory importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()
```

- [ ] **Step 4: Install numpy**

```bash
cd backend && source venv/bin/activate && pip install numpy==1.26.4
```

Expected output: `Successfully installed numpy-1.26.4`

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/tests/
git commit -m "chore: add numpy dep and test scaffold for second-brain phase 1"
```

---

### Task 2: DB — memory_chunks table and CRUD methods

**Files:**
- Modify: `backend/app/db.py` (in `_legacy_init_db` method + new async methods at end of class)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_db_memory.py`:

```python
import pytest
import tempfile
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))


@pytest.fixture
def temp_db(tmp_path):
    """Creates a temporary DatabaseManager with a fresh DB."""
    from db import DatabaseManager
    db_file = str(tmp_path / "test.db")
    return DatabaseManager(db_path=db_file)


@pytest.mark.asyncio
async def test_save_and_retrieve_memory_chunk(temp_db):
    embedding = [0.1, 0.2, 0.3]
    await temp_db.save_memory_chunk(
        id="chunk-1",
        meeting_id="meeting-abc",
        meeting_title="Q2 Planning",
        source_type="transcript",
        content="We decided to ship the API redesign in Q3.",
        embedding_json=json.dumps(embedding),
        created_at="2026-04-06T10:00:00",
    )
    chunks = await temp_db.get_all_memory_chunks()
    assert len(chunks) == 1
    assert chunks[0]["id"] == "chunk-1"
    assert chunks[0]["meeting_title"] == "Q2 Planning"
    assert chunks[0]["content"] == "We decided to ship the API redesign in Q3."


@pytest.mark.asyncio
async def test_delete_meeting_chunks(temp_db):
    embedding = [0.1, 0.2, 0.3]
    await temp_db.save_memory_chunk(
        id="chunk-1", meeting_id="m1", meeting_title="M1",
        source_type="transcript", content="text1",
        embedding_json=json.dumps(embedding), created_at="2026-04-06T10:00:00",
    )
    await temp_db.save_memory_chunk(
        id="chunk-2", meeting_id="m2", meeting_title="M2",
        source_type="transcript", content="text2",
        embedding_json=json.dumps(embedding), created_at="2026-04-06T10:00:00",
    )
    await temp_db.delete_memory_chunks_for_meeting("m1")
    chunks = await temp_db.get_all_memory_chunks()
    assert len(chunks) == 1
    assert chunks[0]["id"] == "chunk-2"


@pytest.mark.asyncio
async def test_memory_chunk_count(temp_db):
    count = await temp_db.get_memory_chunk_count()
    assert count == 0
    embedding = [0.1, 0.2, 0.3]
    await temp_db.save_memory_chunk(
        id="chunk-1", meeting_id="m1", meeting_title="M1",
        source_type="transcript", content="text",
        embedding_json=json.dumps(embedding), created_at="2026-04-06T10:00:00",
    )
    count = await temp_db.get_memory_chunk_count()
    assert count == 1
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_db_memory.py -v
```

Expected: `AttributeError: 'DatabaseManager' object has no attribute 'save_memory_chunk'`

- [ ] **Step 3: Add memory_chunks table to _legacy_init_db in db.py**

Find the `_legacy_init_db` method in `backend/app/db.py`. After the last `CREATE TABLE IF NOT EXISTS` block (before `conn.commit()`), add:

```python
            # Create memory_chunks table for second-brain RAG feature
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS memory_chunks (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    meeting_title TEXT NOT NULL DEFAULT '',
                    source_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            # Index for fast meeting-based lookups and deletes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_memory_chunks_meeting_id
                ON memory_chunks(meeting_id)
            """)
```

- [ ] **Step 4: Add four async CRUD methods to DatabaseManager**

At the end of the `DatabaseManager` class in `backend/app/db.py`, add:

```python
    async def save_memory_chunk(
        self,
        id: str,
        meeting_id: str,
        meeting_title: str,
        source_type: str,
        content: str,
        embedding_json: str,
        created_at: str,
    ) -> None:
        """Upsert a memory chunk (insert or replace)."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT OR REPLACE INTO memory_chunks
                    (id, meeting_id, meeting_title, source_type, content, embedding_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (id, meeting_id, meeting_title, source_type, content, embedding_json, created_at),
            )
            await db.commit()

    async def get_all_memory_chunks(self) -> list:
        """Return all memory chunks (id, meeting_id, meeting_title, source_type, content, embedding_json)."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id, meeting_id, meeting_title, source_type, content, embedding_json FROM memory_chunks"
            ) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]

    async def delete_memory_chunks_for_meeting(self, meeting_id: str) -> None:
        """Delete all memory chunks belonging to a meeting (used before re-indexing)."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "DELETE FROM memory_chunks WHERE meeting_id = ?", (meeting_id,)
            )
            await db.commit()

    async def get_memory_chunk_count(self) -> int:
        """Return total number of indexed chunks."""
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT COUNT(*) FROM memory_chunks") as cursor:
                row = await cursor.fetchone()
                return row[0] if row else 0
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_db_memory.py -v
```

Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/app/db.py backend/tests/test_db_memory.py
git commit -m "feat(memory): add memory_chunks table and CRUD methods to DatabaseManager"
```

---

### Task 3: Embedding service and cosine search

**Files:**
- Create: `backend/app/embeddings.py`
- Create: `backend/tests/test_embeddings.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_embeddings.py`:

```python
import pytest
import sys
import os
from unittest.mock import AsyncMock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))


# --- cosine_search tests (pure, no mocking needed) ---

def test_cosine_search_returns_top_k():
    from embeddings import cosine_search
    candidates = [
        {"id": "a", "embedding": [1.0, 0.0, 0.0], "content": "alpha"},
        {"id": "b", "embedding": [0.0, 1.0, 0.0], "content": "beta"},
        {"id": "c", "embedding": [0.9, 0.1, 0.0], "content": "close to alpha"},
    ]
    results = cosine_search(query_embedding=[1.0, 0.0, 0.0], candidates=candidates, top_k=2)
    assert len(results) == 2
    assert results[0]["id"] == "a"   # exact match is first
    assert results[1]["id"] == "c"   # second closest


def test_cosine_search_returns_scores():
    from embeddings import cosine_search
    candidates = [{"id": "x", "embedding": [1.0, 0.0], "content": "x"}]
    results = cosine_search([1.0, 0.0], candidates, top_k=1)
    assert abs(results[0]["score"] - 1.0) < 1e-6


def test_cosine_search_empty_candidates():
    from embeddings import cosine_search
    results = cosine_search([1.0, 0.0], [], top_k=5)
    assert results == []


def test_cosine_search_top_k_larger_than_candidates():
    from embeddings import cosine_search
    candidates = [{"id": "a", "embedding": [1.0, 0.0], "content": "a"}]
    results = cosine_search([1.0, 0.0], candidates, top_k=10)
    assert len(results) == 1  # only 1 available


# --- EmbeddingService tests (mocked Ollama) ---

@pytest.mark.asyncio
async def test_embed_one_returns_list_of_floats():
    from embeddings import EmbeddingService

    mock_response = MagicMock()
    mock_response.embedding = [0.1, 0.2, 0.3]

    with patch("embeddings.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.embeddings.return_value = mock_response
        mock_client_cls.return_value = mock_client

        svc = EmbeddingService()
        result = await svc.embed_one("hello world")

    assert result == [0.1, 0.2, 0.3]


@pytest.mark.asyncio
async def test_embed_one_handles_dict_response():
    """Ollama SDK <=0.3 returned dicts; ensure we handle both."""
    from embeddings import EmbeddingService

    with patch("embeddings.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.embeddings.return_value = {"embedding": [0.4, 0.5, 0.6]}
        mock_client_cls.return_value = mock_client

        svc = EmbeddingService()
        result = await svc.embed_one("hello world")

    assert result == [0.4, 0.5, 0.6]
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_embeddings.py -v
```

Expected: `ModuleNotFoundError: No module named 'embeddings'`

- [ ] **Step 3: Create backend/app/embeddings.py**

```python
"""
embeddings.py — Ollama-based embedding service + numpy cosine search.

Requires:
  - Ollama running locally (default: http://127.0.0.1:11434)
  - nomic-embed-text model pulled: `ollama pull nomic-embed-text`
"""

import os
import logging
from typing import List

import numpy as np
from ollama import AsyncClient

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "nomic-embed-text"


class EmbeddingService:
    """Wraps Ollama's embedding endpoint for local, private text embeddings."""

    def __init__(self):
        self.host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
        self.model = os.getenv("EMBEDDING_MODEL", EMBEDDING_MODEL)

    async def embed_one(self, text: str) -> List[float]:
        """Embed a single string. Returns a list of floats."""
        client = AsyncClient(host=self.host)
        response = await client.embeddings(model=self.model, prompt=text)
        # Handle both dict response (ollama SDK <=0.3) and object response (>=0.4)
        if isinstance(response, dict):
            return response["embedding"]
        return list(response.embedding)

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed multiple strings sequentially. Returns a list of embedding vectors."""
        results = []
        for text in texts:
            results.append(await self.embed_one(text))
        return results


def cosine_search(
    query_embedding: List[float],
    candidates: List[dict],
    top_k: int = 5,
) -> List[dict]:
    """
    Find the top_k most similar candidates to query_embedding using cosine similarity.

    Args:
        query_embedding: The query vector.
        candidates: Each dict must have an 'embedding' key (List[float]).
                    All other keys are passed through unchanged.
        top_k: Maximum number of results to return.

    Returns:
        List of candidate dicts sorted by similarity (highest first),
        each augmented with a 'score' float in [0, 1].
    """
    if not candidates:
        return []

    q = np.array(query_embedding, dtype=np.float32)
    q_norm = np.linalg.norm(q)
    if q_norm == 0:
        return candidates[:top_k]

    scored = []
    for c in candidates:
        v = np.array(c["embedding"], dtype=np.float32)
        v_norm = np.linalg.norm(v)
        if v_norm == 0:
            score = 0.0
        else:
            score = float(np.dot(q, v) / (q_norm * v_norm))
        scored.append({**c, "score": score})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_embeddings.py -v
```

Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/embeddings.py backend/tests/test_embeddings.py
git commit -m "feat(memory): add EmbeddingService (Ollama) and cosine_search"
```

---

### Task 4: Memory indexer

**Files:**
- Create: `backend/app/memory_indexer.py`
- Create: `backend/tests/test_memory_indexer.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_memory_indexer.py`:

```python
import pytest
import sys
import os
import json
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))


def make_mock_db(meeting=None, note=None):
    db = AsyncMock()
    db.get_meeting.return_value = meeting or {
        "id": "m1",
        "title": "Product Review",
        "created_at": "2026-04-06T10:00:00",
        "transcripts": [
            {"id": "t1", "text": "We decided to delay the launch by two weeks."},
            {"id": "t2", "text": "Action item: update the roadmap by Friday."},
        ],
    }
    db.get_meeting_note.return_value = note
    db.delete_memory_chunks_for_meeting.return_value = None
    db.save_memory_chunk.return_value = None
    return db


def make_mock_embedding_svc():
    svc = AsyncMock()
    svc.embed_one.return_value = [0.1] * 768
    return svc


@pytest.mark.asyncio
async def test_index_meeting_saves_transcript_chunks():
    from memory_indexer import MemoryIndexer

    db = make_mock_db()
    svc = make_mock_embedding_svc()
    indexer = MemoryIndexer(db=db, embedding_svc=svc)

    count = await indexer.index_meeting("m1")

    assert count == 2  # 2 transcript segments
    assert db.save_memory_chunk.call_count == 2
    # Verify first chunk args
    call_kwargs = db.save_memory_chunk.call_args_list[0].kwargs
    assert call_kwargs["meeting_id"] == "m1"
    assert call_kwargs["source_type"] == "transcript"
    assert "decided to delay" in call_kwargs["content"]


@pytest.mark.asyncio
async def test_index_meeting_also_indexes_note_paragraphs():
    from memory_indexer import MemoryIndexer

    note = {
        "content_markdown": (
            "## Summary\n\n"
            "The team agreed to delay launch.\n\n"
            "Action items were assigned to all members."
        )
    }
    db = make_mock_db(note=note)
    svc = make_mock_embedding_svc()
    indexer = MemoryIndexer(db=db, embedding_svc=svc)

    count = await indexer.index_meeting("m1")

    # 2 transcripts + 2 note paragraphs (header "## Summary" is < 20 chars, skipped)
    assert count == 4
    source_types = [c.kwargs["source_type"] for c in db.save_memory_chunk.call_args_list]
    assert source_types.count("note") == 2


@pytest.mark.asyncio
async def test_index_meeting_skips_short_text():
    from memory_indexer import MemoryIndexer

    db = make_mock_db(meeting={
        "id": "m1",
        "title": "Short",
        "created_at": "2026-04-06T10:00:00",
        "transcripts": [
            {"id": "t1", "text": "OK."},        # too short
            {"id": "t2", "text": "A" * 50},     # long enough
        ],
    })
    svc = make_mock_embedding_svc()
    indexer = MemoryIndexer(db=db, embedding_svc=svc)

    count = await indexer.index_meeting("m1")
    assert count == 1


@pytest.mark.asyncio
async def test_index_meeting_deletes_existing_chunks_first():
    from memory_indexer import MemoryIndexer

    db = make_mock_db()
    svc = make_mock_embedding_svc()
    indexer = MemoryIndexer(db=db, embedding_svc=svc)

    await indexer.index_meeting("m1")

    db.delete_memory_chunks_for_meeting.assert_called_once_with("m1")


@pytest.mark.asyncio
async def test_index_meeting_returns_zero_for_missing_meeting():
    from memory_indexer import MemoryIndexer

    db = AsyncMock()
    db.get_meeting.return_value = None
    svc = make_mock_embedding_svc()
    indexer = MemoryIndexer(db=db, embedding_svc=svc)

    count = await indexer.index_meeting("nonexistent")
    assert count == 0
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_memory_indexer.py -v
```

Expected: `ModuleNotFoundError: No module named 'memory_indexer'`

- [ ] **Step 3: Create backend/app/memory_indexer.py**

```python
"""
memory_indexer.py — Chunks and embeds meeting content into the memory_chunks table.

Indexing strategy:
  - Each transcript segment → one chunk (they are already naturally chunked by the recording pipeline)
  - AI note content → split by double-newline (paragraph), skip paragraphs < 20 chars
  - Existing chunks for a meeting are deleted before re-indexing (idempotent)
"""

import json
import logging
from datetime import datetime

from db import DatabaseManager
from embeddings import EmbeddingService

logger = logging.getLogger(__name__)

MIN_CONTENT_LENGTH = 10   # transcript segments shorter than this are skipped
MIN_NOTE_PARA_LENGTH = 20  # note paragraphs shorter than this are skipped


class MemoryIndexer:
    def __init__(self, db: DatabaseManager, embedding_svc: EmbeddingService):
        self.db = db
        self.embedding_svc = embedding_svc

    async def index_meeting(self, meeting_id: str) -> int:
        """
        Index all transcript segments and AI note paragraphs for a meeting.
        Existing chunks are replaced (idempotent — safe to call multiple times).

        Returns:
            Number of chunks indexed (0 if meeting not found).
        """
        meeting = await self.db.get_meeting(meeting_id)
        if not meeting:
            logger.warning(f"index_meeting: meeting {meeting_id!r} not found, skipping")
            return 0

        title = meeting.get("title", "")
        created_at = meeting.get("created_at", datetime.utcnow().isoformat())

        # Always delete first so re-indexing is safe
        await self.db.delete_memory_chunks_for_meeting(meeting_id)

        chunks_saved = 0

        # --- Transcript segments ---
        for transcript in meeting.get("transcripts", []):
            text = transcript.get("text", "").strip()
            if len(text) < MIN_CONTENT_LENGTH:
                continue
            chunk_id = f"t-{transcript['id']}"
            embedding = await self.embedding_svc.embed_one(text)
            await self.db.save_memory_chunk(
                id=chunk_id,
                meeting_id=meeting_id,
                meeting_title=title,
                source_type="transcript",
                content=text,
                embedding_json=json.dumps(embedding),
                created_at=created_at,
            )
            chunks_saved += 1

        # --- AI note paragraphs ---
        note = await self.db.get_meeting_note(meeting_id)
        if note and note.get("content_markdown"):
            paragraphs = [
                p.strip()
                for p in note["content_markdown"].split("\n\n")
                if len(p.strip()) >= MIN_NOTE_PARA_LENGTH
            ]
            for i, para in enumerate(paragraphs):
                chunk_id = f"n-{meeting_id}-{i}"
                embedding = await self.embedding_svc.embed_one(para)
                await self.db.save_memory_chunk(
                    id=chunk_id,
                    meeting_id=meeting_id,
                    meeting_title=title,
                    source_type="note",
                    content=para,
                    embedding_json=json.dumps(embedding),
                    created_at=created_at,
                )
                chunks_saved += 1

        logger.info(f"Indexed {chunks_saved} chunks for meeting {meeting_id!r} ('{title}')")
        return chunks_saved

    async def index_all(self) -> int:
        """
        Re-index every meeting in the database.
        Returns total chunk count across all meetings.
        """
        meetings = await self.db.get_all_meetings()
        total = 0
        for m in meetings:
            total += await self.index_meeting(m["id"])
        logger.info(f"Full re-index complete: {total} chunks across {len(meetings)} meetings")
        return total
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_memory_indexer.py -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/memory_indexer.py backend/tests/test_memory_indexer.py
git commit -m "feat(memory): add MemoryIndexer — chunks and embeds meetings into DB"
```

---

### Task 5: Wiki compiler — LLM compiles meetings into structured articles

This is the core Karpathy insight: raw meeting data should be **compiled by the LLM into a structured wiki**, not just indexed as raw chunks. The compiler writes one `.md` article per meeting plus a global `_index.md` that maps all meetings. These articles are the primary context for Q&A — not raw transcript fragments.

**Files:**
- Create: `backend/app/wiki_compiler.py`
- Create: `backend/tests/test_wiki_compiler.py`

The wiki lives at `~/.adamant/wiki/` (configurable via `ADAMANT_WIKI_DIR` env var):
```
~/.adamant/wiki/
  _index.md                    ← auto-maintained directory of all meetings
  meetings/
    {meeting_id}.md            ← one article per meeting, LLM-written
```

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_wiki_compiler.py`:

```python
import pytest
import sys
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))


def make_mock_db(meeting=None, note=None):
    db = AsyncMock()
    db.get_meeting.return_value = meeting or {
        "id": "m1",
        "title": "Product Review Q2",
        "created_at": "2026-04-06T10:00:00",
        "transcripts": [
            {"id": "t1", "text": "We decided to delay the API launch by two weeks."},
            {"id": "t2", "text": "Alice will update the roadmap by Friday."},
        ],
    }
    db.get_meeting_note.return_value = note
    db.get_all_meetings.return_value = [{"id": "m1", "title": "Product Review Q2"}]
    return db


@pytest.mark.asyncio
async def test_compile_meeting_creates_md_file(tmp_path):
    from wiki_compiler import WikiCompiler

    db = make_mock_db()
    compiler = WikiCompiler(db=db, wiki_dir=tmp_path)

    with patch("wiki_compiler.chat_completion", new=AsyncMock(return_value="# Product Review Q2\n\n**Summary:** We delayed the API.")):
        path = await compiler.compile_meeting("m1")

    assert path is not None
    article_path = tmp_path / "meetings" / "m1.md"
    assert article_path.exists()
    content = article_path.read_text()
    assert "Product Review Q2" in content


@pytest.mark.asyncio
async def test_compile_meeting_updates_index(tmp_path):
    from wiki_compiler import WikiCompiler

    db = make_mock_db()
    compiler = WikiCompiler(db=db, wiki_dir=tmp_path)

    article_text = "# Product Review Q2\n\n**Summary:** We delayed the API launch by two weeks."
    with patch("wiki_compiler.chat_completion", new=AsyncMock(return_value=article_text)):
        await compiler.compile_meeting("m1")

    index_path = tmp_path / "_index.md"
    assert index_path.exists()
    index = index_path.read_text()
    assert "Product Review Q2" in index


@pytest.mark.asyncio
async def test_compile_meeting_returns_none_for_missing(tmp_path):
    from wiki_compiler import WikiCompiler

    db = AsyncMock()
    db.get_meeting.return_value = None
    compiler = WikiCompiler(db=db, wiki_dir=tmp_path)

    result = await compiler.compile_meeting("nonexistent")
    assert result is None


@pytest.mark.asyncio
async def test_compile_all_creates_articles_for_each_meeting(tmp_path):
    from wiki_compiler import WikiCompiler

    db = AsyncMock()
    db.get_all_meetings.return_value = [
        {"id": "m1", "title": "Meeting 1"},
        {"id": "m2", "title": "Meeting 2"},
    ]
    db.get_meeting.side_effect = lambda mid: {
        "id": mid, "title": f"Meeting {mid[-1]}", "created_at": "2026-04-06T10:00:00", "transcripts": [
            {"id": f"t-{mid}", "text": f"We discussed topic {mid[-1]}."}
        ]
    }
    db.get_meeting_note.return_value = None

    compiler = WikiCompiler(db=db, wiki_dir=tmp_path)
    with patch("wiki_compiler.chat_completion", new=AsyncMock(return_value="# Article\n\n**Summary:** Summary text.")):
        count = await compiler.compile_all()

    assert count == 2
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_wiki_compiler.py -v
```

Expected: `ModuleNotFoundError: No module named 'wiki_compiler'`

- [ ] **Step 3: Create backend/app/wiki_compiler.py**

```python
"""
wiki_compiler.py — LLM compiles raw meeting data into structured wiki articles.

Karpathy principle: "raw data from a given number of sources is collected, then
compiled by an LLM into a .md wiki... You rarely ever write or edit the wiki
manually, it's the domain of the LLM."

Wiki structure:
  {wiki_dir}/
    _index.md                  ← auto-maintained index of all meetings
    meetings/
      {meeting_id}.md          ← one structured article per meeting
"""

import logging
import os
from pathlib import Path
from typing import Optional

from db import DatabaseManager
from llm_client import chat_completion

logger = logging.getLogger(__name__)

WIKI_COMPILE_PROMPT = """You are compiling a personal knowledge wiki article for a meeting.
Write a structured markdown article based on the transcript and notes below.

Use EXACTLY this format:

# {title}

**Date:** {date}
**Summary:** (2-3 sentence plain-language overview of what happened)

## Key Decisions
- (bullet list — each decision on its own line, or "None recorded" if none)

## Action Items
- (bullet list with owner if mentioned, e.g. "Alice: update the roadmap by Friday", or "None recorded")

## People Mentioned
- (bullet list of names and their role/context, or "None recorded")

## Topics Covered
- (bullet list of concepts, projects, or themes discussed)

## Notes
(any other important points not captured above)

---

Keep it factual and concise. Do not invent information not present in the source material.
Correct obvious transcription errors (e.g. homophones, misspellings of names).
"""


def _default_wiki_dir() -> Path:
    custom = os.getenv("ADAMANT_WIKI_DIR")
    if custom:
        return Path(custom)
    return Path.home() / ".adamant" / "wiki"


class WikiCompiler:
    """
    Compiles raw meeting content (transcripts + AI notes) into structured .md wiki articles.
    Maintains a global _index.md that maps all meetings for fast LLM orientation.
    """

    def __init__(self, db: DatabaseManager, wiki_dir: Optional[Path] = None):
        self.db = db
        self.wiki_dir = Path(wiki_dir) if wiki_dir else _default_wiki_dir()
        self.meetings_dir = self.wiki_dir / "meetings"
        self.meetings_dir.mkdir(parents=True, exist_ok=True)

    async def compile_meeting(self, meeting_id: str) -> Optional[str]:
        """
        Generate (or regenerate) the wiki article for one meeting.

        Returns:
            Absolute path to the written .md file, or None if meeting not found.
        """
        meeting = await self.db.get_meeting(meeting_id)
        if not meeting:
            logger.warning(f"compile_meeting: meeting {meeting_id!r} not found")
            return None

        title = meeting.get("title", "Untitled Meeting")
        date = meeting.get("created_at", "")[:10]  # YYYY-MM-DD

        # Assemble raw content
        transcript_text = "\n".join(
            t.get("text", "") for t in meeting.get("transcripts", [])
        ).strip()

        note = await self.db.get_meeting_note(meeting_id)
        notes_md = (note.get("content_markdown") or "") if note else ""

        raw_content = f"Transcript:\n{transcript_text}"
        if notes_md:
            raw_content += f"\n\nMy Notes:\n{notes_md}"

        # Truncate to avoid overwhelming the context window
        raw_content = raw_content[:12000]

        prompt = WIKI_COMPILE_PROMPT.format(title=title, date=date) + f"\n\n---\n\n{raw_content}"

        model_config = await self.db.get_model_config()
        if not model_config:
            logger.warning("compile_meeting: no model configured, skipping wiki compilation")
            return None

        article = await chat_completion(
            messages=[{"role": "user", "content": prompt}],
            provider=model_config["provider"],
            model_name=model_config["model"],
        )

        # Write article
        article_path = self.meetings_dir / f"{meeting_id}.md"
        article_path.write_text(article, encoding="utf-8")
        logger.info(f"Compiled wiki article: {article_path}")

        # Keep the global index current
        await self._update_index()

        return str(article_path)

    async def compile_all(self) -> int:
        """
        Recompile wiki articles for every meeting.
        Returns total count of articles written.
        """
        meetings = await self.db.get_all_meetings()
        count = 0
        for m in meetings:
            result = await self.compile_meeting(m["id"])
            if result:
                count += 1
        logger.info(f"Full wiki recompile: {count} articles written")
        return count

    async def _update_index(self) -> None:
        """
        Regenerate _index.md: a brief directory of all compiled meeting articles.
        The LLM reads this file first to orient itself before diving into specific articles.
        """
        entries = []
        for md_file in sorted(self.meetings_dir.glob("*.md")):
            content = md_file.read_text(encoding="utf-8")
            lines = content.splitlines()

            # Extract title (first # heading) and summary (**Summary:** line)
            title = md_file.stem
            summary = ""
            date = ""
            for line in lines:
                if line.startswith("# ") and not title:
                    title = line[2:].strip()
                if line.startswith("**Date:**"):
                    date = line.replace("**Date:**", "").strip()
                if line.startswith("**Summary:**"):
                    summary = line.replace("**Summary:**", "").strip()
                if title and summary and date:
                    break

            meeting_id = md_file.stem
            link = f"meetings/{md_file.name}"
            entry = f"- [{title}]({link})"
            if date:
                entry += f" ({date})"
            if summary:
                entry += f": {summary}"
            entries.append(entry)

        index_content = (
            "# Meeting Wiki Index\n\n"
            "This index is auto-maintained by Adamant. "
            "Each entry links to a compiled meeting article.\n\n"
            + ("\n".join(entries) if entries else "_No meetings compiled yet._")
        )
        (self.wiki_dir / "_index.md").write_text(index_content, encoding="utf-8")
        logger.debug(f"Updated wiki index: {len(entries)} entries")

    def read_article(self, meeting_id: str) -> Optional[str]:
        """Read a compiled wiki article. Returns None if not found."""
        path = self.meetings_dir / f"{meeting_id}.md"
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def read_index(self) -> str:
        """Read the global _index.md. Returns empty string if not yet generated."""
        path = self.wiki_dir / "_index.md"
        if path.exists():
            return path.read_text(encoding="utf-8")
        return ""
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_wiki_compiler.py -v
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/wiki_compiler.py backend/tests/test_wiki_compiler.py
git commit -m "feat(memory): add WikiCompiler — LLM compiles meetings into structured .md articles"
```

---

### Task 6: Free-form LLM client

**Files:**
- Create: `backend/app/llm_client.py`
- Create: `backend/tests/test_llm_client.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_llm_client.py`:

```python
import pytest
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))

MESSAGES = [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "What is 2+2?"},
]


@pytest.mark.asyncio
async def test_chat_completion_ollama():
    from llm_client import chat_completion

    mock_response = MagicMock()
    mock_response.message.content = "The answer is 4."

    with patch("llm_client.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.chat.return_value = mock_response
        mock_cls.return_value = mock_client

        result = await chat_completion(MESSAGES, provider="ollama", model_name="llama3")

    assert result == "The answer is 4."
    mock_client.chat.assert_called_once_with(model="llama3", messages=MESSAGES)


@pytest.mark.asyncio
async def test_chat_completion_ollama_dict_response():
    """Ollama SDK older versions return dicts."""
    from llm_client import chat_completion

    with patch("llm_client.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.chat.return_value = {"message": {"content": "Four."}}
        mock_cls.return_value = mock_client

        result = await chat_completion(MESSAGES, provider="ollama", model_name="llama3")

    assert result == "Four."


@pytest.mark.asyncio
async def test_chat_completion_unsupported_provider():
    from llm_client import chat_completion

    with pytest.raises(ValueError, match="Unsupported provider"):
        await chat_completion(MESSAGES, provider="unknown", model_name="gpt-99")
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_llm_client.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm_client'`

- [ ] **Step 3: Create backend/app/llm_client.py**

```python
"""
llm_client.py — Free-form LLM chat for all supported providers.

Unlike TranscriptProcessor (which uses pydantic-ai for structured output),
this module provides simple string responses for conversational use cases.

Supported providers: "ollama", "claude", "groq", "openai"
"""

import os
import logging
from typing import List, Dict

from db import DatabaseManager

logger = logging.getLogger(__name__)

_db = DatabaseManager()


async def chat_completion(
    messages: List[Dict[str, str]],
    provider: str,
    model_name: str,
) -> str:
    """
    Send messages to the configured LLM and return the reply as a string.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": "..."}.
        provider: One of "ollama", "claude", "groq", "openai".
        model_name: The specific model name (e.g. "llama3", "claude-3-5-sonnet-20241022").

    Returns:
        The assistant's reply as a plain string.

    Raises:
        ValueError: If the provider is unsupported or an API key is missing.
    """
    if provider == "ollama":
        return await _chat_ollama(messages, model_name)
    elif provider == "claude":
        return await _chat_claude(messages, model_name)
    elif provider in ("groq", "openai"):
        return await _chat_openai_compatible(messages, model_name, provider)
    else:
        raise ValueError(f"Unsupported provider: {provider!r}")


async def _chat_ollama(messages: List[Dict], model_name: str) -> str:
    from ollama import AsyncClient
    ollama_host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    client = AsyncClient(host=ollama_host)
    response = await client.chat(model=model_name, messages=messages)
    if isinstance(response, dict):
        return response["message"]["content"]
    return response.message.content


async def _chat_claude(messages: List[Dict], model_name: str) -> str:
    import anthropic
    api_key = await _db.get_api_key("claude")
    if not api_key:
        raise ValueError("Anthropic API key not configured. Add it in Settings.")
    client = anthropic.AsyncAnthropic(api_key=api_key)
    system_content = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    non_system = [m for m in messages if m["role"] != "system"]
    kwargs = {"model": model_name, "max_tokens": 1024, "messages": non_system}
    if system_content:
        kwargs["system"] = system_content
    response = await client.messages.create(**kwargs)
    return response.content[0].text


async def _chat_openai_compatible(messages: List[Dict], model_name: str, provider: str) -> str:
    from openai import AsyncOpenAI
    if provider == "groq":
        api_key = await _db.get_api_key("groq")
        base_url = "https://api.groq.com/openai/v1"
    else:
        api_key = await _db.get_api_key("openai")
        base_url = "https://api.openai.com/v1"
    if not api_key:
        raise ValueError(f"{provider} API key not configured. Add it in Settings.")
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    response = await client.chat.completions.create(
        model=model_name, messages=messages, max_tokens=1024
    )
    return response.choices[0].message.content
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_llm_client.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat(memory): add llm_client for free-form chat across all providers"
```

---

### Task 7: Wiki-first Q&A service

**Files:**
- Create: `backend/app/memory_chat.py`
- Create: `backend/tests/test_memory_chat.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_memory_chat.py`:

```python
import pytest
import sys
import os
import json
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))


def make_chunks(n=3):
    return [
        {
            "id": f"chunk-{i}",
            "meeting_id": f"meeting-{i}",
            "meeting_title": f"Meeting {i}",
            "source_type": "transcript",
            "content": f"Content about topic {i}",
            "embedding_json": json.dumps([float(i + 1) / 10] * 768),
            "embedding": [float(i + 1) / 10] * 768,
        }
        for i in range(n)
    ]


def make_mock_wiki(articles=None):
    """Mock WikiCompiler that returns pre-canned articles."""
    wiki = MagicMock()
    articles = articles or {}
    wiki.read_article.side_effect = lambda mid: articles.get(mid)
    wiki.read_index.return_value = "# Meeting Wiki Index\n\n- [Meeting 0](meetings/meeting-0.md): Summary 0"
    return wiki


@pytest.mark.asyncio
async def test_chat_uses_wiki_articles_as_context():
    from memory_chat import MemoryChatService

    mock_db = AsyncMock()
    mock_db.get_memory_chunk_count.return_value = 3
    mock_db.get_all_memory_chunks.return_value = make_chunks(3)
    mock_db.get_model_config.return_value = {"provider": "ollama", "model": "llama3"}

    mock_svc = AsyncMock()
    mock_svc.embed_one.return_value = [0.3] * 768  # closest to chunk-2 (0.3*768)

    wiki = make_mock_wiki({"meeting-2": "# Meeting 2\n\n**Summary:** We discussed topic 2."})

    captured_messages = []

    async def capture_chat(messages, provider, model_name):
        captured_messages.extend(messages)
        return "The answer is X."

    with patch("memory_chat.chat_completion", new=capture_chat):
        service = MemoryChatService(db=mock_db, embedding_svc=mock_svc, wiki_compiler=wiki)
        result = await service.chat("What happened in meeting 2?")

    assert result["answer"] == "The answer is X."
    # System prompt should contain the wiki article content
    system_content = captured_messages[0]["content"]
    assert "Meeting 2" in system_content
    assert "Summary:" in system_content or "topic 2" in system_content


@pytest.mark.asyncio
async def test_chat_falls_back_to_raw_chunks_when_no_article():
    from memory_chat import MemoryChatService

    mock_db = AsyncMock()
    mock_db.get_memory_chunk_count.return_value = 3
    mock_db.get_all_memory_chunks.return_value = make_chunks(3)
    mock_db.get_model_config.return_value = {"provider": "ollama", "model": "llama3"}

    mock_svc = AsyncMock()
    mock_svc.embed_one.return_value = [0.1] * 768

    # No wiki articles exist
    wiki = make_mock_wiki({})

    captured = []

    async def capture(messages, provider, model_name):
        captured.extend(messages)
        return "Fallback answer."

    with patch("memory_chat.chat_completion", new=capture):
        service = MemoryChatService(db=mock_db, embedding_svc=mock_svc, wiki_compiler=wiki)
        result = await service.chat("question?")

    assert result["answer"] == "Fallback answer."
    # Context should still contain raw chunk content
    system_content = captured[0]["content"]
    assert "Content about topic" in system_content


@pytest.mark.asyncio
async def test_chat_returns_message_when_no_chunks():
    from memory_chat import MemoryChatService

    mock_db = AsyncMock()
    mock_db.get_memory_chunk_count.return_value = 0
    wiki = make_mock_wiki()

    service = MemoryChatService(db=mock_db, embedding_svc=AsyncMock(), wiki_compiler=wiki)
    result = await service.chat("Anything?")

    assert "compiled" in result["answer"].lower() or "indexed" in result["answer"].lower()
    assert result["citations"] == []


@pytest.mark.asyncio
async def test_chat_returns_message_when_no_model():
    from memory_chat import MemoryChatService

    mock_db = AsyncMock()
    mock_db.get_memory_chunk_count.return_value = 5
    mock_db.get_all_memory_chunks.return_value = make_chunks(3)
    mock_db.get_model_config.return_value = None

    mock_svc = AsyncMock()
    mock_svc.embed_one.return_value = [0.1] * 768

    service = MemoryChatService(db=mock_db, embedding_svc=mock_svc, wiki_compiler=make_mock_wiki())
    result = await service.chat("What happened?")

    assert "configured" in result["answer"].lower()
    assert result["citations"] == []


@pytest.mark.asyncio
async def test_citations_deduplicated_by_meeting_id():
    from memory_chat import MemoryChatService

    # Three chunks all from the same meeting
    chunks = [
        {
            "id": f"chunk-{i}",
            "meeting_id": "same-meeting",
            "meeting_title": "Repeated Meeting",
            "source_type": "transcript",
            "content": f"segment {i}",
            "embedding_json": json.dumps([0.5] * 768),
            "embedding": [0.5] * 768,
        }
        for i in range(3)
    ]

    mock_db = AsyncMock()
    mock_db.get_memory_chunk_count.return_value = 3
    mock_db.get_all_memory_chunks.return_value = chunks
    mock_db.get_model_config.return_value = {"provider": "ollama", "model": "llama3"}

    mock_svc = AsyncMock()
    mock_svc.embed_one.return_value = [0.5] * 768

    with patch("memory_chat.chat_completion", new=AsyncMock(return_value="Answer.")):
        service = MemoryChatService(
            db=mock_db, embedding_svc=mock_svc, wiki_compiler=make_mock_wiki()
        )
        result = await service.chat("question?")

    assert len(result["citations"]) == 1
    assert result["citations"][0]["meeting_id"] == "same-meeting"
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_memory_chat.py -v
```

Expected: `ModuleNotFoundError: No module named 'memory_chat'`

- [ ] **Step 3: Create backend/app/memory_chat.py**

```python
"""
memory_chat.py — Wiki-first Q&A: embed query → find relevant meeting IDs →
read compiled wiki articles → LLM answer with citations.

Karpathy principle: "I thought I had to reach for fancy RAG, but the LLM has
been pretty good about auto-maintaining index files and brief summaries of all
the documents and it reads all the important related data fairly easily."

Pipeline:
  1. Vector search over raw chunks → identify top-3 relevant meeting IDs
  2. Read the compiled wiki article for each meeting ID (full structured .md)
  3. If no wiki article exists for a meeting, fall back to the raw chunk text
  4. Pass wiki articles (+ global index header) as LLM context
  5. Return answer with meeting citations
"""

import json
import logging
from typing import List, Dict

from db import DatabaseManager
from embeddings import EmbeddingService, cosine_search
from wiki_compiler import WikiCompiler
from llm_client import chat_completion

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a personal meeting assistant for Adamant.
You have access to compiled wiki articles from the user's meeting history, provided below.

Answer the user's question based ONLY on the provided meeting content.
If the content doesn't contain enough information, say so clearly — do not invent details.

Be concise and specific. When referencing information from a particular meeting,
mention the meeting title so the user knows where it came from."""

TOP_K_MEETINGS = 3   # number of wiki articles to retrieve
MAX_HISTORY_TURNS = 6  # last 3 exchanges (user+assistant pairs)
MAX_ARTICLE_CHARS = 4000  # max chars per wiki article in context


class MemoryChatService:
    def __init__(
        self,
        db: DatabaseManager,
        embedding_svc: EmbeddingService,
        wiki_compiler: WikiCompiler,
    ):
        self.db = db
        self.embedding_svc = embedding_svc
        self.wiki_compiler = wiki_compiler

    async def chat(
        self,
        query: str,
        history: List[Dict[str, str]] = None,
    ) -> Dict:
        """
        Answer a question using wiki-first retrieval.

        Args:
            query: The user's question.
            history: Prior messages as [{"role": "user"|"assistant", "content": "..."}].
                     System message is added internally — do not include it here.

        Returns:
            {
                "answer": str,
                "citations": [{"meeting_id": str, "meeting_title": str}]
            }
        """
        history = history or []

        # Guard: nothing indexed yet
        chunk_count = await self.db.get_memory_chunk_count()
        if chunk_count == 0:
            return {
                "answer": (
                    "No meetings have been compiled yet. "
                    "Save some meetings and click **Re-compile wiki** on the Memory page "
                    "to build your knowledge base."
                ),
                "citations": [],
            }

        # Guard: no model configured
        model_config = await self.db.get_model_config()
        if not model_config:
            return {
                "answer": "No LLM configured. Please set up a model in **Settings** first.",
                "citations": [],
            }

        # 1. Embed the query and find the most relevant meeting IDs via cosine search
        query_embedding = await self.embedding_svc.embed_one(query)
        raw_chunks = await self.db.get_all_memory_chunks()
        for chunk in raw_chunks:
            chunk["embedding"] = json.loads(chunk["embedding_json"])

        top_chunks = cosine_search(query_embedding, raw_chunks, top_k=TOP_K_MEETINGS * 3)

        # Deduplicate to get unique meeting IDs in relevance order
        seen_ids: set = set()
        relevant_meeting_ids = []
        for chunk in top_chunks:
            mid = chunk.get("meeting_id", "")
            if mid and mid not in seen_ids:
                seen_ids.add(mid)
                relevant_meeting_ids.append((mid, chunk.get("meeting_title", "")))
            if len(relevant_meeting_ids) >= TOP_K_MEETINGS:
                break

        # 2. Build context from wiki articles (falling back to raw chunk text)
        context_parts = []
        citations = []
        for meeting_id, meeting_title in relevant_meeting_ids:
            article = self.wiki_compiler.read_article(meeting_id)
            if article:
                # Trim long articles to avoid overwhelming the context window
                context_parts.append(article[:MAX_ARTICLE_CHARS])
            else:
                # Fallback: use raw chunk text for this meeting
                meeting_chunks = [c for c in top_chunks if c.get("meeting_id") == meeting_id]
                fallback = "\n".join(c["content"] for c in meeting_chunks[:3])
                context_parts.append(f"# {meeting_title}\n\n{fallback}")

            citations.append({"meeting_id": meeting_id, "meeting_title": meeting_title})

        # Prepend index overview so the LLM knows the full scope of the knowledge base
        index_header = self.wiki_compiler.read_index()
        if index_header:
            context_parts.insert(0, f"## Your Meeting Index\n\n{index_header[:2000]}")

        context = "\n\n---\n\n".join(context_parts)

        # 3. Build message list and generate answer
        messages = [
            {
                "role": "system",
                "content": f"{SYSTEM_PROMPT}\n\n## Meeting Knowledge Base\n\n{context}",
            }
        ]
        for h in history[-MAX_HISTORY_TURNS:]:
            messages.append(h)
        messages.append({"role": "user", "content": query})

        answer = await chat_completion(
            messages=messages,
            provider=model_config["provider"],
            model_name=model_config["model"],
        )

        return {"answer": answer, "citations": citations}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_memory_chat.py -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/memory_chat.py backend/tests/test_memory_chat.py
git commit -m "feat(memory): add MemoryChatService — wiki-first Q&A with citations"
```

---

### Task 8: API endpoints

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_memory_api.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_memory_api.py`:

```python
import pytest
import sys
import os
from unittest.mock import AsyncMock, patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))

from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Return a TestClient with memory services mocked out."""
    with (
        patch("main.memory_chat_service") as mock_chat_svc,
        patch("main.memory_indexer") as mock_indexer,
        patch("main.db") as mock_db,
    ):
        mock_db.get_memory_chunk_count = AsyncMock(return_value=42)
        mock_db.get_all_meetings = AsyncMock(return_value=[{"id": "m1"}, {"id": "m2"}])
        mock_chat_svc.chat = AsyncMock(return_value={
            "answer": "We decided to ship in Q3.",
            "citations": [{"meeting_id": "m1", "meeting_title": "Planning", "source_type": "transcript"}],
        })
        mock_indexer.index_meeting = AsyncMock(return_value=5)
        mock_indexer.index_all = AsyncMock(return_value=42)

        from main import app
        yield TestClient(app)


def test_memory_stats(client):
    resp = client.get("/api/memory/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert "chunk_count" in body
    assert "meeting_count" in body


def test_memory_chat_returns_answer(client):
    resp = client.post("/api/memory/chat", json={"query": "What did we decide?", "history": []})
    assert resp.status_code == 200
    body = resp.json()
    assert "answer" in body
    assert "citations" in body
    assert len(body["citations"]) == 1


def test_memory_chat_requires_query(client):
    resp = client.post("/api/memory/chat", json={})
    assert resp.status_code == 422  # pydantic validation error


def test_memory_index_single_meeting(client):
    resp = client.post("/api/memory/index/m1")
    assert resp.status_code == 200
    assert resp.json()["chunks_indexed"] == 5


def test_memory_index_all(client):
    resp = client.post("/api/memory/index-all")
    assert resp.status_code == 200
    assert "previous_chunk_count" in resp.json()
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_memory_api.py -v
```

Expected: `ImportError` or attribute errors (endpoints don't exist yet)

- [ ] **Step 3: Add Pydantic models and service instances to main.py**

At the top of `backend/app/main.py`, after the existing imports, add:

```python
from embeddings import EmbeddingService
from memory_indexer import MemoryIndexer
from wiki_compiler import WikiCompiler
from memory_chat import MemoryChatService

# Module-level instances (initialized once at startup)
_embedding_svc = EmbeddingService()
memory_indexer = MemoryIndexer(db=db, embedding_svc=_embedding_svc)
wiki_compiler = WikiCompiler(db=db)
memory_chat_service = MemoryChatService(db=db, embedding_svc=_embedding_svc, wiki_compiler=wiki_compiler)
```

- [ ] **Step 4: Add request/response Pydantic models to main.py**

After the existing Pydantic model definitions (near the top of `main.py`), add:

```python
class MemoryChatRequest(BaseModel):
    query: str
    history: List[dict] = []

class MemoryChatResponse(BaseModel):
    answer: str
    citations: List[dict]

class MemoryStatsResponse(BaseModel):
    chunk_count: int
    meeting_count: int
```

- [ ] **Step 5: Add the four /api/memory/* endpoints to main.py**

Add before the `@app.on_event("shutdown")` handler:

```python
@app.get("/api/memory/stats", response_model=MemoryStatsResponse)
async def memory_stats():
    """Return current knowledge base statistics."""
    chunk_count = await db.get_memory_chunk_count()
    meetings = await db.get_all_meetings()
    return MemoryStatsResponse(chunk_count=chunk_count, meeting_count=len(meetings))


@app.post("/api/memory/chat", response_model=MemoryChatResponse)
async def memory_chat(request: MemoryChatRequest):
    """Answer a question using RAG over indexed meeting content."""
    try:
        result = await memory_chat_service.chat(
            query=request.query,
            history=request.history,
        )
        return MemoryChatResponse(**result)
    except Exception as e:
        logger.error(f"memory_chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/memory/index/{meeting_id}")
async def memory_index_meeting(meeting_id: str, background_tasks: BackgroundTasks):
    """Index (or re-index) a single meeting in the background."""
    background_tasks.add_task(memory_indexer.index_meeting, meeting_id)
    return {"status": "indexing", "meeting_id": meeting_id, "chunks_indexed": await memory_indexer.index_meeting(meeting_id)}


@app.post("/api/memory/index-all")
async def memory_index_all(background_tasks: BackgroundTasks):
    """Re-index all meetings and recompile all wiki articles. Runs in the background."""
    async def _full_recompile():
        await memory_indexer.index_all()
        await wiki_compiler.compile_all()

    background_tasks.add_task(_full_recompile)
    chunk_count = await db.get_memory_chunk_count()
    return {"status": "reindexing_started", "previous_chunk_count": chunk_count}
```

> **Note:** `memory_index_meeting` calls `index_meeting` twice (once for the immediate count, once via background task). Simplify by calling synchronously for the response:

Replace the `memory_index_meeting` body with:

```python
@app.post("/api/memory/index/{meeting_id}")
async def memory_index_meeting(meeting_id: str):
    """Index (or re-index) a single meeting synchronously."""
    try:
        chunks = await memory_indexer.index_meeting(meeting_id)
        return {"status": "indexed", "meeting_id": meeting_id, "chunks_indexed": chunks}
    except Exception as e:
        logger.error(f"memory_index_meeting error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_memory_api.py -v
```

Expected: `5 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_memory_api.py
git commit -m "feat(memory): add /api/memory/* endpoints (chat, index, stats)"
```

---

### Task 9: Auto-pipeline on meeting save — embed + compile wiki

**Files:**
- Modify: `backend/app/main.py` (the `/save-transcript` endpoint)

When a new meeting is saved, three things should happen automatically in the background: (1) embed transcript chunks, (2) compile a wiki article, (3) update `_index.md`. This is the full Karpathy pipeline — raw data → compiled wiki — triggered on every save.

- [ ] **Step 1: Add background indexing to the /save-transcript endpoint**

In `backend/app/main.py`, find the `/save-transcript` endpoint. It currently ends with:

```python
        logger.info("Transcripts saved successfully")
        return {"status": "success", "message": "Transcript saved successfully", "meeting_id": meeting_id}
```

Add a `background_tasks: BackgroundTasks` parameter to the function signature and trigger indexing before the return:

```python
@app.post("/save-transcript")
async def save_transcript(request: SaveTranscriptRequest, background_tasks: BackgroundTasks):
    """Save transcript segments for a meeting without processing"""
    try:
        # ... (existing code unchanged) ...

        logger.info("Transcripts saved successfully")
        # Auto-pipeline: embed chunks + compile wiki article in the background
        async def _index_and_compile(mid: str):
            await memory_indexer.index_meeting(mid)
            await wiki_compiler.compile_meeting(mid)

        background_tasks.add_task(_index_and_compile, meeting_id)
        return {"status": "success", "message": "Transcript saved successfully", "meeting_id": meeting_id}
    except Exception as e:
        logger.error(f"Error saving transcript: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 2: Verify the backend still starts cleanly**

```bash
cd backend && source venv/bin/activate && python app/main.py &
sleep 3 && curl -s http://localhost:5167/api/memory/stats | python -m json.tool
kill %1
```

Expected output (exact numbers will vary):
```json
{
    "chunk_count": 0,
    "meeting_count": 0
}
```

- [ ] **Step 3: Run full backend test suite**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -v --ignore=tests/test_memory_api.py
```

Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(memory): auto-index meetings in background after /save-transcript"
```

---

### Task 10: Frontend — Memory page

**Files:**
- Create: `frontend/src/app/memory/page.tsx`

- [ ] **Step 1: Create the Memory page**

Create `frontend/src/app/memory/page.tsx`:

```tsx
'use client';

import React, { useState, useCallback } from 'react';
import MemoryChat from '@/components/MemoryChat';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

export default function MemoryPage() {
  return (
    <div className="flex flex-col h-screen bg-background">
      <div
        className="flex items-center justify-between px-6 py-4 border-b border-border/40"
        style={{ minHeight: 56 }}
      >
        <div>
          <h1 className="text-lg font-semibold text-foreground">Memory</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ask questions about your meeting history
          </p>
        </div>
        <ReindexButton />
      </div>
      <div className="flex-1 overflow-hidden">
        <MemoryChat />
      </div>
    </div>
  );
}

function ReindexButton() {
  const { serverAddress } = useSidebar();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const handleReindex = useCallback(async () => {
    setStatus('loading');
    try {
      const resp = await fetch(`${serverAddress}/api/memory/index-all`, { method: 'POST' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setStatus('done');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, []);

  const label =
    status === 'loading' ? 'Compiling…' :
    status === 'done'    ? 'Done!' :
    status === 'error'   ? 'Failed' :
    'Re-compile wiki';

  return (
    <button
      onClick={handleReindex}
      disabled={status === 'loading'}
      style={{
        padding: '6px 14px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        background: status === 'done' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: status === 'done' ? 'rgb(134,239,172)' : 'rgba(255,255,255,0.75)',
        cursor: status === 'loading' ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Verify the page compiles**

```bash
cd frontend && pnpm run build 2>&1 | tail -20
```

Expected: no TypeScript errors for the new page (warnings about the existing codebase are fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/memory/
git commit -m "feat(memory): add Memory page shell with Re-index button"
```

---

### Task 11: Frontend — MemoryChat component

**Files:**
- Create: `frontend/src/components/MemoryChat.tsx`

- [ ] **Step 1: Create MemoryChat.tsx**

Create `frontend/src/components/MemoryChat.tsx`:

```tsx
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Brain, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSidebar } from './Sidebar/SidebarProvider';

interface Citation {
  meeting_id: string;
  meeting_title: string;
  source_type: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export default function MemoryChat() {
  const { serverAddress } = useSidebar();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const query = input.trim();
    if (!query || isLoading) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: query,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Build history from prior messages (exclude the one we just added)
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch(`${serverAddress}/api/memory/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, history }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        citations: data.citations ?? [],
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: Message = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: 'Something went wrong. Make sure the backend is running and try again.',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, messages, serverAddress]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <EmptyState />
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onCitationClick={id => router.push(`/meeting-details?id=${id}`)}
          />
        ))}
        {isLoading && <ThinkingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div
        className="px-4 pb-4 pt-2 border-t border-border/40"
        style={{ background: 'rgba(0,0,0,0.15)' }}
      >
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your meetings…"
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none py-1"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="p-1.5 rounded-lg transition-all"
            style={{
              background: input.trim() && !isLoading ? 'rgba(99,102,241,0.8)' : 'rgba(255,255,255,0.06)',
              color: input.trim() && !isLoading ? 'white' : 'rgba(255,255,255,0.3)',
            }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-center text-xs text-muted-foreground/50 mt-2">
          Answers are grounded in your meeting history · All processing is local
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 text-center px-8">
      <Brain className="w-10 h-10 text-muted-foreground/40 mb-4" />
      <p className="text-sm font-medium text-foreground/70 mb-1">Ask your meeting memory anything</p>
      <p className="text-xs text-muted-foreground/50 max-w-xs">
        Try: "What did we decide about the roadmap?" or "Who is responsible for the API redesign?"
      </p>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground/60">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span className="text-xs">Searching your meetings…</span>
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  onCitationClick: (meetingId: string) => void;
}

function MessageBubble({ message, onCitationClick }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div style={{ maxWidth: '80%' }}>
        <div
          className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
          style={{
            background: isUser
              ? 'rgba(99,102,241,0.75)'
              : 'rgba(255,255,255,0.07)',
            border: isUser ? 'none' : '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.92)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.content}
        </div>

        {/* Citations */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 pl-1">
            {message.citations.map(c => (
              <button
                key={c.meeting_id}
                onClick={() => onCitationClick(c.meeting_id)}
                className="text-xs px-2.5 py-1 rounded-full transition-all hover:opacity-80"
                style={{
                  background: 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  color: 'rgba(165,180,252,0.9)',
                }}
              >
                ↗ {c.meeting_title || 'Meeting'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd frontend && pnpm run build 2>&1 | tail -20
```

Expected: clean build (no errors in `MemoryChat.tsx` or `memory/page.tsx`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MemoryChat.tsx
git commit -m "feat(memory): add MemoryChat component with RAG chat UI and citations"
```

---

### Task 12: Frontend — Add Memory to sidebar navigation

**Files:**
- Modify: `frontend/src/components/Sidebar/index.tsx`

The sidebar has two states: collapsed (shows icon buttons) and expanded (shows full nav). We need to add a Memory/Brain entry to both states.

- [ ] **Step 1: Add Brain to the lucide-react import**

In `frontend/src/components/Sidebar/index.tsx`, find the import line:

```tsx
import { ChevronDown, ChevronRight, File, Settings, ChevronLeftCircle, ChevronRightCircle, Calendar, StickyNote, Home, Trash2, Plus, Search, Pencil, NotebookPen, SearchIcon, X, FolderPlus, Square, CheckSquare } from 'lucide-react';
```

Add `Brain` to the import list:

```tsx
import { ChevronDown, ChevronRight, File, Settings, ChevronLeftCircle, ChevronRightCircle, Calendar, StickyNote, Home, Trash2, Plus, Search, Pencil, NotebookPen, SearchIcon, X, FolderPlus, Square, CheckSquare, Brain } from 'lucide-react';
```

- [ ] **Step 2: Add isMemoryPage detection**

Find this block (around line 610):

```tsx
    const isHomePage = pathname === '/';
    const isMeetingPage = pathname?.includes('/meeting-details');
    const isSettingsPage = pathname === '/settings';
```

Add one line:

```tsx
    const isHomePage = pathname === '/';
    const isMeetingPage = pathname?.includes('/meeting-details');
    const isSettingsPage = pathname === '/settings';
    const isMemoryPage = pathname === '/memory';
```

- [ ] **Step 3: Add collapsed-sidebar Memory button**

In the collapsed sidebar section, find the Settings icon button (around line 655). It looks like:

```tsx
                onClick={() => router.push('/settings')}
                onMouseEnter={() => setHoverCollapsedSettings(true)}
                onMouseLeave={() => setHoverCollapsedSettings(false)}
```

Add a Memory button **before** the Settings button, following the exact same inline-style pattern used for Settings:

```tsx
                {/* Memory button — collapsed sidebar */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => router.push('/memory')}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: isMemoryPage ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${isMemoryPage ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)'}`,
                          cursor: 'pointer',
                          transition: 'all 0.18s ease',
                          marginBottom: 4,
                        }}
                      >
                        <Brain className="w-5 h-5 text-foreground/75" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right"><p>Memory</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
```

- [ ] **Step 4: Add expanded-sidebar Memory nav item**

In the expanded sidebar, find where the Settings navigation entry is in the bottom nav area (it uses `router.push('/settings')` and shows `<Settings className=...>`). Add a Memory entry above it following the same pattern. Look for the expanded settings button near line 876:

```tsx
                onClick={() => router.push('/')}
```

After the Home button and before the Settings button in the expanded sidebar's bottom navigation area, add:

```tsx
              {/* Memory nav item — expanded sidebar */}
              <button
                onClick={() => router.push('/memory')}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: isMemoryPage ? 'rgba(255,255,255,0.10)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: 13,
                  fontWeight: isMemoryPage ? 600 : 400,
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (!isMemoryPage) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                }}
                onMouseLeave={e => {
                  if (!isMemoryPage) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <Brain className="w-4 h-4 flex-shrink-0" />
                <span>Memory</span>
              </button>
```

- [ ] **Step 5: Verify compilation**

```bash
cd frontend && pnpm run build 2>&1 | tail -30
```

Expected: clean build with no TypeScript errors.

- [ ] **Step 6: Smoke test in dev mode**

```bash
cd frontend && pnpm run tauri:dev
```

Verify:
1. A Brain icon appears in the sidebar (both collapsed and expanded states)
2. Clicking it navigates to `/memory`
3. The Memory page loads with the chat input visible
4. The "Re-index all meetings" button is present at the top

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Sidebar/index.tsx
git commit -m "feat(memory): add Memory nav item to sidebar (collapsed and expanded)"
```

---

## Setup: Pull the embedding model

> **One-time step for the developer setting up this feature.** This is not part of automated tests.

Before using the Memory page, the `nomic-embed-text` model must be available in Ollama:

```bash
ollama pull nomic-embed-text
```

This is a ~270 MB download. The model name can be overridden by setting `EMBEDDING_MODEL` in the backend's `.env` file (e.g. `EMBEDDING_MODEL=mxbai-embed-large` for 335-dim embeddings).

---

## Running All Tests

```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -v
```

Expected: all tests pass.

---

## Known Limitations (Phase 2 / 3 work)

| Limitation | Phase |
|------------|-------|
| No concept articles (people, projects, decisions extracted as linked entities) | Phase 2 |
| No in-app wiki browser (read/edit compiled articles inside Adamant) | Phase 3 |
| Q&A outputs are not saved back into the wiki — Karpathy's "filing outputs back" loop | Phase 2 |
| No wiki linting / health checks (find inconsistencies, impute missing info) | Phase 2 |
| Cosine search loads all embeddings into memory at query time — suitable for <2,000 meetings; needs a vector index beyond that | Future optimization |
| Chat history is session-only (not persisted across page reloads) | Phase 2 |
| Updating a note after the fact doesn't trigger auto-recompile of that meeting's wiki article | Phase 2 |
