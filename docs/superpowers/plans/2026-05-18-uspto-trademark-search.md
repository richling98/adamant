# USPTO Trademark Image Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a trademark logo search tool where all data lives in Google Cloud, the search API runs on Google Cloud Run, and the user's local computer only needs a tiny CLI script (~50 KB). Drop a logo on your computer → results appear. Nothing stored locally.

**Architecture:** Three-layer system: (1) a one-time local setup script downloads USPTO data, builds DINOv2 embeddings + Vienna codes, and uploads everything to Google Cloud Storage; (2) a FastAPI server running on Google Cloud Run loads the index from Cloud Storage and handles all search computation; (3) a minimal local CLI sends the query image to the Cloud Run API and displays results. Your coworker uses the same CLI with the same URL — no setup on their end.

> 🗣 **In plain English:** Think of it like Google Photos' search feature. You don't store Google's AI on your phone — you send a photo, Google's servers find similar ones, and results come back. This works the same way, except the server is YOUR private Google Cloud account, not Google's consumer product. Your logo goes to your own server, not anyone else's.

**Tech Stack:**
- **Setup (runs once, locally):** Python, lxml, httpx, DINOv2 (transformers + torch), faiss-cpu, google-cloud-storage
- **Server (runs on Google Cloud Run):** FastAPI, uvicorn, DINOv2, FAISS (IVFPQ compressed), google-cloud-storage
- **CLI (runs locally, always):** httpx, click — nothing else

---

## End Result

**You (or your coworker) runs:**
```bash
python cli.py search ./my_logo.png
```

**Output:**
```
Sending to trademark search API...

Logo Trademark Search — my_logo.png
──────────────────────────────────────────────────────
⚠️  Informational only — not legal advice. Consult a trademark attorney.

Predicted Vienna categories: 26.01.01 (circles), 26.04.03 (triangles)

#1  Combined: 91%  [Visual: 94% | Vienna: 85%]  —  Reg #4123456
    Mark:   APEX (design)
    Owner:  APEX SPORTS LLC
    Class:  25 (Clothing)  |  Status: 🟢 LIVE  |  Filed: 2015-03-10
    Vienna: 26.01.01, 26.04.03
...
```

**What's on your computer after setup:** The `cli.py` script and Python. Nothing else.
**What's on your coworker's computer:** Same `cli.py` script. That's it.

---

## Google Cloud Prerequisites

> 🗣 **Before any code is written, the following must exist in Google Cloud. This is a one-time setup you do in a web browser — not code.**

### Required accounts and services:
1. **Google Cloud account** — sign up at cloud.google.com (free tier available)
2. **A Google Cloud Project** — create one at console.cloud.google.com (e.g., `trademark-search`)
3. **Billing enabled** on the project — required even for free-tier services (won't be charged for casual use)
4. **APIs enabled** — in the Google Cloud Console, enable:
   - Cloud Run API
   - Cloud Storage API
   - Artifact Registry API (for storing Docker images)
5. **`gcloud` CLI installed** — download from cloud.google.com/sdk, then run `gcloud auth login`

### Cost estimate (casual use):
| Service | What it does | Monthly cost |
|---|---|---|
| Cloud Storage | Stores index + DB (~15 GB) | ~$0.30/month |
| Cloud Run | Runs search server when queried | Free (2M req/month free tier) |
| Artifact Registry | Stores Docker image | ~$0.10/month |
| **Total** | | **~$0.40/month** |

> 🗣 This is cheaper than a cup of coffee per month. Cloud Run only charges when someone is actually searching — it sleeps (and costs nothing) the rest of the time.

---

## How the Overall System Works (Plain English Overview)

1. **One-time setup (you do this once):** Your computer downloads USPTO bulk data, runs each trademark logo through DINOv2 to get its visual fingerprint, builds a compressed FAISS search catalog, and uploads everything to Google Cloud Storage. This takes hours/days but only happens once.

2. **The search server (always running in Google Cloud):** A small Python web server lives on Cloud Run. When you send it a logo image, it: (a) runs the image through DINOv2 locally on the server, (b) searches the FAISS catalog for the most similar trademark fingerprints, (c) applies Vienna code re-ranking, (d) returns the top matches as JSON.

3. **The CLI (your daily driver):** A ~50-line Python script on your computer. You point it at a logo file, it sends the file to the Cloud Run URL, and prints the results. No AI model, no database, no index — just a messenger.

4. **Your coworker:** Gets a copy of `cli.py` and the Cloud Run URL. Searches instantly with no setup.

---

## File Structure

```
tools/trademark_image_search/
├── requirements_setup.txt        # Deps for one-time local setup (heavy: torch, etc.)
├── requirements_server.txt       # Deps for Cloud Run server (same heavy deps)
├── requirements_client.txt       # Deps for local CLI (tiny: httpx, click only)
│
├── setup/                        # Runs once on your local machine
│   ├── run_setup.py              # Master setup script: download → embed → upload
│   ├── metadata_parser.py        # USPTO XML → SQLite (design marks + Vienna codes)
│   ├── image_downloader.py       # Downloads trademark images from USPTO TSDR
│   └── gcs_uploader.py           # Uploads built index + DB to Google Cloud Storage
│
├── server/                       # Runs on Google Cloud Run
│   ├── main.py                   # FastAPI search API
│   ├── Dockerfile                # Container definition for Cloud Run
│   └── .dockerignore
│
├── shared/                       # Used by both setup and server
│   ├── dinov2_embedder.py        # DINOv2 ViT-L/14: image → 1024-dim vector
│   ├── faiss_index.py            # IVFPQ FAISS index: build, save, load, query
│   └── vienna_ranker.py          # Vienna code inference + combined score re-ranking
│
├── client/
│   └── cli.py                    # Tiny local CLI: send image → display results
│
└── tests/
    ├── __init__.py
    ├── fixtures/
    │   ├── sample_design_marks.xml
    │   └── query_logo.png
    ├── test_metadata_parser.py
    ├── test_image_downloader.py
    ├── test_dinov2_embedder.py
    ├── test_faiss_index.py
    ├── test_vienna_ranker.py
    └── test_server.py
```

**Google Cloud Storage layout:**
```
gs://{your-project}-trademark-search/
  marks.db           # SQLite trademark metadata (~1.5 GB)
  marks.faiss        # Compressed IVFPQ index (~400 MB)
  serial_map.npy     # Serial number lookup (~30 MB)
```

---

## Task 1: Project Scaffold + Google Cloud Setup

> 🗣 **In plain English:** Create the folder structure and three separate requirements files — one for setup (needs the heavy AI libraries), one for the server (same heavy libs), and one for the daily-use CLI (just two small libraries). Also write the database blueprint, which now includes Vienna codes.

**Files:**
- Create: `tools/trademark_image_search/requirements_setup.txt`
- Create: `tools/trademark_image_search/requirements_server.txt`
- Create: `tools/trademark_image_search/requirements_client.txt`
- Create: `tools/trademark_image_search/shared/schema.sql`
- Create: all `__init__.py` and empty `__init__.py` files

- [ ] **Step 1: Create requirements_setup.txt**

> 🗣 Everything needed to run the one-time local setup: AI model, image processing, database, and Google Cloud Storage client.

```
torch==2.3.0
transformers==4.41.2
faiss-cpu==1.8.0
numpy==1.26.4
lxml==5.2.2
Pillow==10.3.0
httpx==0.27.0
tqdm==4.66.4
google-cloud-storage==2.16.0
pytest==8.2.1
```

- [ ] **Step 2: Create requirements_server.txt**

> 🗣 What the Cloud Run server needs: same AI/FAISS libs plus FastAPI (the web framework) and uvicorn (the web server that runs FastAPI).

```
torch==2.3.0
transformers==4.41.2
faiss-cpu==1.8.0
numpy==1.26.4
Pillow==10.3.0
google-cloud-storage==2.16.0
fastapi==0.111.0
uvicorn==0.29.0
python-multipart==0.0.9
```

- [ ] **Step 3: Create requirements_client.txt**

> 🗣 What your daily-use CLI needs — just two small libraries. This is all your coworker needs to install. No AI, no database, nothing heavy.

```
httpx==0.27.0
click==8.1.7
```

- [ ] **Step 4: Create shared/schema.sql**

```sql
CREATE TABLE IF NOT EXISTS design_marks (
    serial_number       TEXT PRIMARY KEY,
    registration_number TEXT,
    mark_text           TEXT,
    mark_type_code      TEXT,
    status_code         TEXT,
    filing_date         TEXT,
    registration_date   TEXT,
    owner_name          TEXT,
    nice_classes        TEXT,
    vienna_codes        TEXT,
    image_downloaded    INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_status  ON design_marks(status_code);
CREATE INDEX IF NOT EXISTS idx_vienna  ON design_marks(vienna_codes);
```

- [ ] **Step 5: Create all folder structure and empty `__init__.py` files**

```bash
mkdir -p tools/trademark_image_search/setup
mkdir -p tools/trademark_image_search/server
mkdir -p tools/trademark_image_search/shared
mkdir -p tools/trademark_image_search/client
mkdir -p tools/trademark_image_search/tests/fixtures
touch tools/trademark_image_search/setup/__init__.py
touch tools/trademark_image_search/server/__init__.py
touch tools/trademark_image_search/shared/__init__.py
touch tools/trademark_image_search/client/__init__.py
touch tools/trademark_image_search/tests/__init__.py
```

- [ ] **Step 6: Verify Google Cloud CLI is authenticated**

> 🗣 This checks that `gcloud` is installed and you're logged in. Replace `YOUR_PROJECT_ID` with the project you created in the Google Cloud Console.

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com storage.googleapis.com artifactregistry.googleapis.com
```

Expected: Each command succeeds without error. `gcloud config set project` shows your project ID.

- [ ] **Step 7: Create the Cloud Storage bucket**

> 🗣 A "bucket" in Google Cloud Storage is like a folder in the cloud where we'll store the trademark database, FAISS index, and serial number map. Replace `YOUR_PROJECT_ID` with your actual project ID.

```bash
gsutil mb -l us-central1 gs://YOUR_PROJECT_ID-trademark-search
```

Expected: `Creating gs://YOUR_PROJECT_ID-trademark-search/...`

- [ ] **Step 8: Install client deps and verify**

```bash
cd tools/trademark_image_search
pip install -r requirements_client.txt
```

Expected: `httpx` and `click` install in seconds.

- [ ] **Step 9: Commit**

```bash
git add tools/trademark_image_search/
git commit -m "feat: scaffold USPTO trademark search — GCP architecture"
```

---

## Task 2: Test Fixtures

> 🗣 **In plain English:** Create fake test data — a small pretend USPTO file with 3 trademarks including Vienna codes, and a simple test logo. These let automated tests run without touching the real USPTO servers or Google Cloud.

**Files:**
- Create: `tools/trademark_image_search/tests/fixtures/sample_design_marks.xml`
- Create: `tools/trademark_image_search/tests/fixtures/query_logo.png`

- [ ] **Step 1: Create sample_design_marks.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<trademark-applications-daily>
  <case-file>
    <serial-number>85123456</serial-number>
    <registration-number>4123456</registration-number>
    <transaction-date>20240101</transaction-date>
    <case-file-header>
      <filing-date>20150310</filing-date>
      <registration-date>20151201</registration-date>
      <status-code>700</status-code>
      <status-date>20151201</status-date>
      <mark-identification>APEX</mark-identification>
      <mark-drawing-code>2000</mark-drawing-code>
    </case-file-header>
    <case-file-owners>
      <case-file-owner><party-name>APEX SPORTS LLC</party-name></case-file-owner>
    </case-file-owners>
    <classifications>
      <classification><international-code-total-no>25</international-code-total-no></classification>
    </classifications>
    <design-search-codes>
      <design-search-code><primary-code>26.01.01</primary-code></design-search-code>
      <design-search-code><primary-code>26.04.03</primary-code></design-search-code>
    </design-search-codes>
    <case-file-statements>
      <case-file-statement>
        <type-code>GS0051</type-code>
        <text>Clothing, namely shirts and hats.</text>
      </case-file-statement>
    </case-file-statements>
  </case-file>
  <case-file>
    <serial-number>77890123</serial-number>
    <registration-number>5890123</registration-number>
    <transaction-date>20240101</transaction-date>
    <case-file-header>
      <filing-date>20180722</filing-date>
      <registration-date>20190301</registration-date>
      <status-code>700</status-code>
      <status-date>20190301</status-date>
      <mark-identification></mark-identification>
      <mark-drawing-code>3000</mark-drawing-code>
    </case-file-header>
    <case-file-owners>
      <case-file-owner><party-name>TRIANGLE BRANDS INC.</party-name></case-file-owner>
    </case-file-owners>
    <classifications>
      <classification><international-code-total-no>9</international-code-total-no></classification>
    </classifications>
    <design-search-codes>
      <design-search-code><primary-code>26.04.03</primary-code></design-search-code>
      <design-search-code><primary-code>26.04.06</primary-code></design-search-code>
    </design-search-codes>
    <case-file-statements>
      <case-file-statement>
        <type-code>GS0051</type-code>
        <text>Computer software for data visualization.</text>
      </case-file-statement>
    </case-file-statements>
  </case-file>
  <case-file>
    <serial-number>76543210</serial-number>
    <registration-number></registration-number>
    <transaction-date>20120601</transaction-date>
    <case-file-header>
      <filing-date>20090105</filing-date>
      <registration-date></registration-date>
      <status-code>602</status-code>
      <status-date>20120601</status-date>
      <mark-identification>OLD BRAND</mark-identification>
      <mark-drawing-code>2000</mark-drawing-code>
    </case-file-header>
    <case-file-owners>
      <case-file-owner><party-name>OLD BRAND CO.</party-name></case-file-owner>
    </case-file-owners>
    <classifications>
      <classification><international-code-total-no>35</international-code-total-no></classification>
    </classifications>
    <design-search-codes>
      <design-search-code><primary-code>05.03.01</primary-code></design-search-code>
    </design-search-codes>
    <case-file-statements>
      <case-file-statement>
        <type-code>GS0051</type-code>
        <text>Business consulting services.</text>
      </case-file-statement>
    </case-file-statements>
  </case-file>
</trademark-applications-daily>
```

- [ ] **Step 2: Generate query_logo.png**

```bash
python -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (224, 224), color=(255, 255, 255))
draw = ImageDraw.Draw(img)
draw.ellipse([40, 40, 184, 184], fill=(30, 80, 200))
draw.polygon([(112, 60), (160, 160), (64, 160)], fill=(255, 255, 255))
img.save('tests/fixtures/query_logo.png')
print('query_logo.png created')
"
```

Expected: `query_logo.png created`

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/
git commit -m "test: add USPTO XML fixture with Vienna codes and test logo"
```

---

## Task 3: Metadata Parser

> 🗣 **In plain English:** Reads the USPTO data file and saves trademark info (including Vienna codes) to a local SQLite database. This runs once during setup on your local machine before uploading to Google Cloud.

**Files:**
- Create: `tools/trademark_image_search/setup/metadata_parser.py`
- Create: `tools/trademark_image_search/tests/test_metadata_parser.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_metadata_parser.py
import sqlite3
from pathlib import Path
import pytest
from setup.metadata_parser import parse_design_marks

FIXTURE = Path(__file__).parent / "fixtures" / "sample_design_marks.xml"
SCHEMA  = Path(__file__).parent.parent / "shared" / "schema.sql"

@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    return conn

def test_parses_all_three_design_marks(db):
    assert parse_design_marks(FIXTURE, db) == 3

def test_rejects_text_only_mark(db, tmp_path):
    xml = tmp_path / "text.xml"
    xml.write_text("""<?xml version="1.0" encoding="UTF-8"?>
<trademark-applications-daily>
  <case-file>
    <serial-number>99999999</serial-number>
    <case-file-header><filing-date>20240101</filing-date><status-code>700</status-code>
      <mark-identification>WORDONLY</mark-identification><mark-drawing-code>1000</mark-drawing-code>
    </case-file-header>
    <case-file-owners><case-file-owner><party-name>CO</party-name></case-file-owner></case-file-owners>
    <classifications><classification><international-code-total-no>9</international-code-total-no></classification></classifications>
    <case-file-statements><case-file-statement><type-code>GS0051</type-code><text>Software.</text></case-file-statement></case-file-statements>
  </case-file>
</trademark-applications-daily>""")
    assert parse_design_marks(xml, db) == 0

def test_vienna_codes_extracted(db):
    parse_design_marks(FIXTURE, db)
    row = db.execute("SELECT vienna_codes FROM design_marks WHERE serial_number = '85123456'").fetchone()
    codes = row[0].split(",")
    assert "26.01.01" in codes
    assert "26.04.03" in codes

def test_live_mark_fields(db):
    parse_design_marks(FIXTURE, db)
    row = db.execute(
        "SELECT mark_text, owner_name, status_code, nice_classes FROM design_marks WHERE serial_number = '85123456'"
    ).fetchone()
    assert row[0] == "APEX"
    assert "APEX SPORTS" in row[1]
    assert row[2] == "700"
    assert "25" in row[3]

def test_dead_mark_status(db):
    parse_design_marks(FIXTURE, db)
    row = db.execute("SELECT status_code FROM design_marks WHERE serial_number = '76543210'").fetchone()
    assert row[0] == "602"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd tools/trademark_image_search
python -m pytest tests/test_metadata_parser.py -v
```

Expected: FAIL — `ModuleNotFoundError: setup.metadata_parser`

- [ ] **Step 3: Implement metadata_parser.py**

```python
# setup/metadata_parser.py
import sqlite3
from pathlib import Path
from lxml import etree

DESIGN_CODES = {"2000", "3000", "5000"}

def _text(el, path: str) -> str:
    node = el.find(path)
    return (node.text or "").strip() if node is not None else ""

def parse_design_marks(xml_path: Path, conn: sqlite3.Connection) -> int:
    tree = etree.parse(str(xml_path))
    rows = []
    for case in tree.findall(".//case-file"):
        serial = _text(case, "serial-number")
        if not serial:
            continue
        header = case.find("case-file-header")
        drawing_code = _text(header, "mark-drawing-code") if header is not None else ""
        if drawing_code not in DESIGN_CODES:
            continue
        classes      = [_text(c, "international-code-total-no") for c in case.findall(".//classification")]
        gs_texts     = [_text(s, "text") for s in case.findall(".//case-file-statement") if _text(s, "type-code").startswith("GS")]
        vienna_codes = [_text(d, "primary-code") for d in case.findall(".//design-search-code") if _text(d, "primary-code")]
        owner_el     = case.find(".//case-file-owner")
        rows.append((
            serial,
            _text(case, "registration-number"),
            _text(header, "mark-identification") if header is not None else "",
            drawing_code,
            _text(header, "status-code")      if header is not None else "",
            _text(header, "filing-date")       if header is not None else "",
            _text(header, "registration-date") if header is not None else "",
            _text(owner_el, "party-name")      if owner_el is not None else "",
            ",".join(filter(None, classes)),
            ",".join(filter(None, vienna_codes)),
            0,
        ))
    conn.executemany(
        """INSERT OR REPLACE INTO design_marks
           (serial_number, registration_number, mark_text, mark_type_code,
            status_code, filing_date, registration_date, owner_name,
            nice_classes, vienna_codes, image_downloaded)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    conn.commit()
    return len(rows)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_metadata_parser.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add setup/metadata_parser.py tests/test_metadata_parser.py
git commit -m "feat: USPTO XML parser — design marks + Vienna codes"
```

---

## Task 4: Image Downloader

> 🗣 **In plain English:** Downloads trademark logo images from USPTO's public servers, one at a time. Same as before — this runs locally during setup before images get processed and uploaded. We do NOT upload the raw images to Google Cloud (they get embedded and deleted to save storage costs).

**Files:**
- Create: `tools/trademark_image_search/setup/image_downloader.py`
- Create: `tools/trademark_image_search/tests/test_image_downloader.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_image_downloader.py
import sqlite3
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from setup.image_downloader import build_image_url, download_image, get_pending_serials

SCHEMA = Path(__file__).parent.parent / "shared" / "schema.sql"

@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    conn.execute(
        "INSERT INTO design_marks (serial_number, status_code, vienna_codes, image_downloaded) VALUES (?,?,?,?)",
        ("85123456", "700", "26.01.01", 0),
    )
    conn.commit()
    return conn

def test_build_image_url():
    assert build_image_url("85123456") == "https://tsdr.uspto.gov/img/85123456/large"

def test_get_pending_serials_returns_undownloaded(db):
    assert "85123456" in get_pending_serials(db)

def test_get_pending_serials_excludes_downloaded(db):
    db.execute("UPDATE design_marks SET image_downloaded = 1 WHERE serial_number = '85123456'")
    db.commit()
    assert "85123456" not in get_pending_serials(db)

def test_download_image_saves_file_and_marks_db(tmp_path, db):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    with patch("httpx.get", return_value=mock_resp):
        assert download_image("85123456", tmp_path, db) is True
    assert (tmp_path / "85123456.jpg").exists()
    assert db.execute("SELECT image_downloaded FROM design_marks WHERE serial_number='85123456'").fetchone()[0] == 1

def test_download_image_skips_404(tmp_path, db):
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    with patch("httpx.get", return_value=mock_resp):
        assert download_image("85123456", tmp_path, db) is False
    assert not (tmp_path / "85123456.jpg").exists()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/test_image_downloader.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement image_downloader.py**

```python
# setup/image_downloader.py
import sqlite3, time
from pathlib import Path
import httpx
from tqdm import tqdm

IMAGE_URL_TEMPLATE = "https://tsdr.uspto.gov/img/{serial}/large"
REQUEST_DELAY_SEC  = 0.15

def build_image_url(serial: str) -> str:
    return IMAGE_URL_TEMPLATE.format(serial=serial)

def get_pending_serials(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute("SELECT serial_number FROM design_marks WHERE image_downloaded = 0").fetchall()]

def download_image(serial: str, images_dir: Path, conn: sqlite3.Connection) -> bool:
    resp = httpx.get(build_image_url(serial), timeout=15, follow_redirects=True)
    if resp.status_code != 200:
        return False
    (images_dir / f"{serial}.jpg").write_bytes(resp.content)
    conn.execute("UPDATE design_marks SET image_downloaded = 1 WHERE serial_number = ?", (serial,))
    conn.commit()
    return True

def download_all_images(images_dir: Path, conn: sqlite3.Connection) -> dict:
    images_dir.mkdir(parents=True, exist_ok=True)
    results = {"downloaded": 0, "skipped": 0, "failed": 0}
    for serial in tqdm(get_pending_serials(conn), desc="Downloading images", unit="img"):
        if (images_dir / f"{serial}.jpg").exists():
            conn.execute("UPDATE design_marks SET image_downloaded = 1 WHERE serial_number = ?", (serial,))
            conn.commit()
            results["skipped"] += 1
            continue
        ok = download_image(serial, images_dir, conn)
        results["downloaded" if ok else "failed"] += 1
        time.sleep(REQUEST_DELAY_SEC)
    return results
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_image_downloader.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add setup/image_downloader.py tests/test_image_downloader.py
git commit -m "feat: USPTO image downloader with resume support"
```

---

## Task 5: DINOv2 Embedder (Shared)

> 🗣 **In plain English:** The AI model that converts any logo image into 1024 numbers. Lives in `shared/` because both the setup script (to build the index) and the Cloud Run server (to embed query images) use the exact same code. DINOv2-large downloads once (~1.1 GB) and caches locally.

**Files:**
- Create: `tools/trademark_image_search/shared/dinov2_embedder.py`
- Create: `tools/trademark_image_search/tests/test_dinov2_embedder.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_dinov2_embedder.py
import numpy as np
from pathlib import Path
from PIL import Image
import pytest
from shared.dinov2_embedder import DINOv2Embedder

FIXTURE_IMG = Path(__file__).parent / "fixtures" / "query_logo.png"

@pytest.fixture(scope="module")
def embedder():
    return DINOv2Embedder()

def test_embed_returns_float32_array(embedder):
    e = embedder.embed_file(FIXTURE_IMG)
    assert isinstance(e, np.ndarray) and e.dtype == np.float32

def test_embed_has_correct_dimension(embedder):
    assert embedder.embed_file(FIXTURE_IMG).shape == (1024,)

def test_embedding_is_unit_normalized(embedder):
    e = embedder.embed_file(FIXTURE_IMG)
    assert abs(float(np.linalg.norm(e)) - 1.0) < 1e-5

def test_same_image_produces_identical_embedding(embedder):
    assert np.allclose(embedder.embed_file(FIXTURE_IMG), embedder.embed_file(FIXTURE_IMG))

def test_similar_images_score_higher_than_dissimilar(embedder, tmp_path):
    img = Image.open(FIXTURE_IMG)
    similar = img.crop((2, 2, 222, 222)).resize((224, 224))
    similar_path = tmp_path / "similar.png"
    similar.save(similar_path)
    different = Image.new("RGB", (224, 224), color=(220, 30, 30))
    different_path = tmp_path / "different.png"
    different.save(different_path)
    base = embedder.embed_file(FIXTURE_IMG)
    assert float(np.dot(base, embedder.embed_file(similar_path))) > float(np.dot(base, embedder.embed_file(different_path)))
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/test_dinov2_embedder.py -v
```

Expected: FAIL — `ModuleNotFoundError: shared.dinov2_embedder`

- [ ] **Step 3: Implement dinov2_embedder.py**

```python
# shared/dinov2_embedder.py
from pathlib import Path
import numpy as np
from PIL import Image
import torch
from transformers import AutoImageProcessor, AutoModel

MODEL_ID = "facebook/dinov2-large"

class DINOv2Embedder:
    def __init__(self, device: str | None = None):
        self._device    = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._processor = AutoImageProcessor.from_pretrained(MODEL_ID)
        self._model     = AutoModel.from_pretrained(MODEL_ID).to(self._device)
        self._model.eval()

    def embed_image(self, image: Image.Image) -> np.ndarray:
        inputs = self._processor(images=image, return_tensors="pt").to(self._device)
        with torch.no_grad():
            outputs = self._model(**inputs)
        vec = outputs.last_hidden_state[:, 0, :].squeeze(0).cpu().float().numpy()
        vec /= np.linalg.norm(vec)
        return vec.astype(np.float32)

    def embed_file(self, path: Path) -> np.ndarray:
        return self.embed_image(Image.open(path).convert("RGB"))
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_dinov2_embedder.py -v
```

Expected: All 5 PASS. First run downloads DINOv2-large (~1.1 GB).

- [ ] **Step 5: Commit**

```bash
git add shared/dinov2_embedder.py tests/test_dinov2_embedder.py
git commit -m "feat: DINOv2 ViT-L/14 embedder — 1024-dim visual fingerprints"
```

---

## Task 6: FAISS Index with IVFPQ Compression

> 🗣 **In plain English:** The visual similarity catalog. For the cloud architecture, we use IVFPQ compression by default — this shrinks the index from 12 GB to ~400 MB, which is critical for keeping Cloud Run memory costs low. Accuracy stays at 90-95%.
>
> IVFPQ works in two stages: first it groups all 3 million logos into 1000 clusters (like sorting them into buckets by visual similarity), then when you search it only checks the most relevant buckets rather than all 3 million — much faster and much smaller.

**Files:**
- Create: `tools/trademark_image_search/shared/faiss_index.py`
- Create: `tools/trademark_image_search/tests/test_faiss_index.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_faiss_index.py
import numpy as np
import pytest
from shared.faiss_index import TrademarkFAISSIndex

DIM = 1024

@pytest.fixture
def small_index(tmp_path):
    # Use flat index for small test data (IVFPQ needs >1000 vectors to train)
    idx = TrademarkFAISSIndex(dim=DIM, use_ivfpq=False)
    vecs = np.random.randn(10, DIM).astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    serials = [f"SN{i:08d}" for i in range(10)]
    idx.add_batch(vecs, serials)
    return idx, vecs, serials

def test_query_returns_results(small_index):
    idx, vecs, serials = small_index
    assert len(idx.query(vecs[0], top_k=3)) == 3

def test_top_result_is_self(small_index):
    idx, vecs, serials = small_index
    results = idx.query(vecs[0], top_k=1)
    assert results[0]["serial_number"] == serials[0]
    assert results[0]["score"] > 0.99

def test_scores_are_descending(small_index):
    idx, vecs, serials = small_index
    scores = [r["score"] for r in idx.query(vecs[0], top_k=5)]
    assert scores == sorted(scores, reverse=True)

def test_save_and_load_roundtrip(small_index, tmp_path):
    idx, vecs, serials = small_index
    idx.save(tmp_path)
    loaded = TrademarkFAISSIndex.load(tmp_path, dim=DIM)
    assert loaded.query(vecs[0], top_k=1)[0]["serial_number"] == serials[0]

def test_default_dim_is_1024():
    idx = TrademarkFAISSIndex()
    assert idx._dim == 1024
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/test_faiss_index.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement faiss_index.py**

```python
# shared/faiss_index.py
from pathlib import Path
import numpy as np
import faiss

_INDEX_FILE   = "marks.faiss"
_SERIALS_FILE = "serial_map.npy"


class TrademarkFAISSIndex:
    def __init__(self, dim: int = 1024, use_ivfpq: bool = True):
        self._dim = dim
        if use_ivfpq:
            # IVFPQ: ~400 MB for 3M marks, ~90-95% accuracy
            # Requires training before adding vectors (done in setup)
            quantizer   = faiss.IndexFlatIP(dim)
            self._index = faiss.IndexIVFPQ(quantizer, dim, 1000, 128, 8)
            self._index.nprobe = 50
        else:
            # Flat: exact results, used for small test datasets
            self._index = faiss.IndexFlatIP(dim)
        self._serials: list[str] = []
        self._use_ivfpq = use_ivfpq

    def train(self, embeddings: np.ndarray) -> None:
        """Train IVFPQ index. Must be called before add_batch when use_ivfpq=True."""
        if self._use_ivfpq:
            self._index.train(embeddings)

    def add_batch(self, embeddings: np.ndarray, serial_numbers: list[str]) -> None:
        assert embeddings.shape[1] == self._dim
        self._index.add(embeddings)
        self._serials.extend(serial_numbers)

    def query(self, embedding: np.ndarray, top_k: int = 10) -> list[dict]:
        vec = embedding.reshape(1, -1).astype(np.float32)
        scores, indices = self._index.search(vec, top_k)
        return [
            {"serial_number": self._serials[idx], "score": float(score)}
            for score, idx in zip(scores[0], indices[0])
            if idx >= 0
        ]

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self._index, str(directory / _INDEX_FILE))
        np.save(str(directory / _SERIALS_FILE), np.array(self._serials))

    @classmethod
    def load(cls, directory: Path, dim: int = 1024) -> "TrademarkFAISSIndex":
        obj = cls.__new__(cls)
        obj._dim     = dim
        obj._index   = faiss.read_index(str(directory / _INDEX_FILE))
        obj._serials = np.load(str(directory / _SERIALS_FILE), allow_pickle=True).tolist()
        return obj
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_faiss_index.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add shared/faiss_index.py tests/test_faiss_index.py
git commit -m "feat: FAISS IVFPQ index — 400 MB compressed, 1024-dim DINOv2"
```

---

## Task 7: Vienna Code Re-ranker (Shared)

> 🗣 **In plain English:** The second lens — design category matching. Lives in `shared/` because the server uses it. Same logic as described earlier: infer your logo's likely Vienna categories from its visual neighborhood, then boost results that share those categories. Combined score = 70% visual + 30% Vienna overlap.

**Files:**
- Create: `tools/trademark_image_search/shared/vienna_ranker.py`
- Create: `tools/trademark_image_search/tests/test_vienna_ranker.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_vienna_ranker.py
import sqlite3
from pathlib import Path
import pytest
from shared.vienna_ranker import predict_vienna_signature, vienna_overlap, rerank_with_vienna

SCHEMA = Path(__file__).parent.parent / "shared" / "schema.sql"

@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    conn.executemany(
        "INSERT INTO design_marks (serial_number, vienna_codes, status_code, image_downloaded) VALUES (?,?,?,?)",
        [("SN001","26.01.01,26.04.03","700",1), ("SN002","26.04.03,26.04.06","700",1), ("SN003","05.03.01","602",1)],
    )
    conn.commit()
    return conn

def test_predict_returns_most_common_code(db):
    hits = [{"serial_number": "SN001", "score": 0.95}, {"serial_number": "SN002", "score": 0.88}]
    sig = predict_vienna_signature(hits, db, top_n=3, min_count=1)
    assert "26.04.03" in sig

def test_vienna_overlap_identical():
    assert vienna_overlap({"26.01.01", "26.04.03"}, {"26.01.01", "26.04.03"}) == 1.0

def test_vienna_overlap_disjoint():
    assert vienna_overlap({"26.01.01"}, {"05.03.01"}) == 0.0

def test_vienna_overlap_partial():
    score = vienna_overlap({"26.01.01", "26.04.03"}, {"26.04.03", "99.99.99"})
    assert 0.0 < score < 1.0

def test_rerank_boosts_vienna_match(db):
    hits = [{"serial_number": "SN001", "score": 0.80}, {"serial_number": "SN003", "score": 0.85}]
    reranked = rerank_with_vienna(hits, {"26.04.03"}, db)
    assert reranked[0]["serial_number"] == "SN001"
    assert "combined_score" in reranked[0]
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/test_vienna_ranker.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement vienna_ranker.py**

```python
# shared/vienna_ranker.py
import sqlite3

VISUAL_WEIGHT = 0.70
VIENNA_WEIGHT = 0.30

def predict_vienna_signature(
    hits: list[dict],
    conn: sqlite3.Connection,
    top_n: int = 50,
    min_count: int = 2,
) -> set[str]:
    code_weights: dict[str, float] = {}
    for hit in hits[:top_n]:
        row = conn.execute(
            "SELECT vienna_codes FROM design_marks WHERE serial_number = ?",
            (hit["serial_number"],),
        ).fetchone()
        if not row or not row[0]:
            continue
        for code in row[0].split(","):
            code = code.strip()
            if code:
                code_weights[code] = code_weights.get(code, 0.0) + hit["score"]
    threshold = min_count * 0.5
    return {code for code, w in code_weights.items() if w >= threshold}

def vienna_overlap(query_codes: set[str], candidate_codes: set[str]) -> float:
    if not query_codes or not candidate_codes:
        return 0.0
    return len(query_codes & candidate_codes) / len(query_codes | candidate_codes)

def rerank_with_vienna(
    hits: list[dict],
    predicted_signature: set[str],
    conn: sqlite3.Connection,
) -> list[dict]:
    enriched = []
    for hit in hits:
        row = conn.execute(
            "SELECT vienna_codes FROM design_marks WHERE serial_number = ?",
            (hit["serial_number"],),
        ).fetchone()
        candidate_codes = {c.strip() for c in row[0].split(",")} if row and row[0] else set()
        v_overlap = vienna_overlap(predicted_signature, candidate_codes)
        enriched.append({
            **hit,
            "vienna_codes":   ",".join(sorted(candidate_codes)),
            "vienna_overlap": round(v_overlap, 3),
            "combined_score": round(VISUAL_WEIGHT * hit["score"] + VIENNA_WEIGHT * v_overlap, 3),
        })
    return sorted(enriched, key=lambda x: x["combined_score"], reverse=True)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_vienna_ranker.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add shared/vienna_ranker.py tests/test_vienna_ranker.py
git commit -m "feat: Vienna code re-ranker — 70/30 combined score"
```

---

## Task 8: GCS Uploader

> 🗣 **In plain English:** After the local setup script builds the FAISS index and database, this script uploads them to Google Cloud Storage. This is the "move everything to the cloud" step. After it runs successfully, you can delete the local copies to reclaim disk space.

**Files:**
- Create: `tools/trademark_image_search/setup/gcs_uploader.py`

- [ ] **Step 1: Implement gcs_uploader.py**

```python
# setup/gcs_uploader.py
from pathlib import Path
from google.cloud import storage
from tqdm import tqdm

def upload_to_gcs(bucket_name: str, local_dir: Path) -> None:
    client  = storage.Client()
    bucket  = client.bucket(bucket_name)
    uploads = [
        ("marks.db",        local_dir / "marks.db"),
        ("marks.faiss",     local_dir / "marks.faiss"),
        ("serial_map.npy",  local_dir / "serial_map.npy"),
    ]

    for blob_name, local_path in uploads:
        if not local_path.exists():
            print(f"  SKIP {blob_name} — not found at {local_path}")
            continue
        size_mb = local_path.stat().st_size / 1e6
        print(f"  Uploading {blob_name} ({size_mb:.0f} MB) → gs://{bucket_name}/{blob_name}")
        blob = bucket.blob(blob_name)
        blob.upload_from_filename(str(local_path))
        print(f"  ✓ {blob_name}")

def download_from_gcs(bucket_name: str, local_dir: Path) -> None:
    """Download index files from GCS to local directory (used by server on startup)."""
    local_dir.mkdir(parents=True, exist_ok=True)
    client  = storage.Client()
    bucket  = client.bucket(bucket_name)
    targets = ["marks.db", "marks.faiss", "serial_map.npy"]
    for blob_name in targets:
        dest = local_dir / blob_name
        if dest.exists():
            continue
        print(f"  Downloading {blob_name} from GCS...")
        bucket.blob(blob_name).download_to_filename(str(dest))
        print(f"  ✓ {blob_name}")
```

- [ ] **Step 2: Verify import works**

```bash
python -c "from setup.gcs_uploader import upload_to_gcs; print('gcs_uploader OK')"
```

Expected: `gcs_uploader OK`

- [ ] **Step 3: Commit**

```bash
git add setup/gcs_uploader.py
git commit -m "feat: GCS uploader/downloader for trademark index files"
```

---

## Task 9: Cloud Run Search Server

> 🗣 **In plain English:** This is the brain that lives in Google Cloud. When it starts up, it downloads the FAISS index and database from Cloud Storage into its own memory. When you send it a logo image, it runs DINOv2, searches FAISS, applies Vienna re-ranking, and sends back JSON results. It's always available — Google manages keeping it running.

**Files:**
- Create: `tools/trademark_image_search/server/main.py`
- Create: `tools/trademark_image_search/tests/test_server.py`

- [ ] **Step 1: Write failing test**

> 🗣 This test checks that the API returns the right shape of response without actually hitting Google Cloud — it patches the index loading so the test runs offline.

```python
# tests/test_server.py
import sqlite3
import numpy as np
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

FIXTURE_IMG = Path(__file__).parent / "fixtures" / "query_logo.png"

def test_search_endpoint_returns_results():
    mock_index = MagicMock()
    mock_index.query.return_value = [
        {"serial_number": "85123456", "score": 0.92},
        {"serial_number": "77890123", "score": 0.84},
    ]
    mock_embedder = MagicMock()
    mock_embedder.embed_image.return_value = np.random.randn(1024).astype(np.float32)

    mock_conn = sqlite3.connect(":memory:")
    schema = (Path(__file__).parent.parent / "shared" / "schema.sql").read_text()
    mock_conn.executescript(schema)
    mock_conn.executemany(
        "INSERT INTO design_marks (serial_number, mark_text, owner_name, nice_classes, status_code, filing_date, registration_number, vienna_codes, image_downloaded) VALUES (?,?,?,?,?,?,?,?,?)",
        [("85123456","APEX","APEX SPORTS LLC","25","700","20150310","4123456","26.01.01,26.04.03",1),
         ("77890123","","TRIANGLE BRANDS INC.","9","700","20180722","5890123","26.04.03",1)],
    )
    mock_conn.commit()

    with patch("server.main._index", mock_index), \
         patch("server.main._embedder", mock_embedder), \
         patch("server.main._conn", mock_conn):
        from server.main import app
        client = TestClient(app)
        with open(FIXTURE_IMG, "rb") as f:
            response = client.post("/search", files={"image": ("logo.png", f, "image/png")})

    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert len(data["results"]) > 0
    assert "combined_score" in data["results"][0]
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/test_server.py -v
```

Expected: FAIL — `ModuleNotFoundError: server.main`

- [ ] **Step 3: Implement server/main.py**

> 🗣 The server loads its data on startup (from Cloud Storage via the `download_from_gcs` function), then listens for incoming image uploads at the `/search` endpoint. `/health` is a simple check that Cloud Run uses to know the server is ready.

```python
# server/main.py
import os
import sqlite3
from pathlib import Path
from io import BytesIO

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.dinov2_embedder import DINOv2Embedder
from shared.faiss_index import TrademarkFAISSIndex
from shared.vienna_ranker import predict_vienna_signature, rerank_with_vienna
from setup.gcs_uploader import download_from_gcs

app = FastAPI(title="USPTO Trademark Image Search")

# Paths inside the container's temporary storage
_DATA_DIR = Path("/tmp/trademark_data")
_BUCKET   = os.environ.get("GCS_BUCKET", "")

_index:    TrademarkFAISSIndex | None = None
_embedder: DINOv2Embedder | None     = None
_conn:     sqlite3.Connection | None  = None

_STATUS_LABEL = {
    "700": "LIVE", "710": "LIVE", "800": "PENDING",
    "602": "DEAD", "603": "DEAD", "606": "DEAD", "610": "DEAD",
}


@app.on_event("startup")
async def startup():
    global _index, _embedder, _conn
    if not _BUCKET:
        raise RuntimeError("GCS_BUCKET environment variable not set")

    print(f"Downloading index files from gs://{_BUCKET} ...")
    download_from_gcs(_BUCKET, _DATA_DIR)

    print("Loading FAISS index...")
    _index = TrademarkFAISSIndex.load(_DATA_DIR)

    print("Loading DINOv2 model...")
    _embedder = DINOv2Embedder()

    print("Opening metadata database...")
    _conn = sqlite3.connect(str(_DATA_DIR / "marks.db"), check_same_thread=False)
    print("Server ready.")


@app.get("/health")
async def health():
    return {"status": "ok", "index_loaded": _index is not None}


@app.post("/search")
async def search(
    image: UploadFile = File(...),
    top_k: int = 10,
    live_only: bool = False,
):
    if _index is None or _embedder is None or _conn is None:
        raise HTTPException(status_code=503, detail="Server still initializing")

    img_bytes = await image.read()
    pil_image = Image.open(BytesIO(img_bytes)).convert("RGB")
    embedding = _embedder.embed_image(pil_image)

    visual_hits   = _index.query(embedding, top_k=50)
    predicted_sig = predict_vienna_signature(visual_hits, _conn, top_n=50, min_count=2)
    reranked      = rerank_with_vienna(visual_hits, predicted_sig, _conn)

    results = []
    for hit in reranked:
        row = _conn.execute(
            "SELECT mark_text, owner_name, nice_classes, status_code, filing_date, registration_number "
            "FROM design_marks WHERE serial_number = ?",
            (hit["serial_number"],),
        ).fetchone()
        if not row:
            continue
        mark_text, owner, classes, status_code, filing, reg_num = row
        status = _STATUS_LABEL.get(status_code or "", "UNKNOWN")
        if live_only and status != "LIVE":
            continue
        results.append({
            "serial_number":       hit["serial_number"],
            "registration_number": reg_num or "",
            "mark_text":           mark_text or "(design only)",
            "owner_name":          owner or "Unknown",
            "nice_classes":        classes or "",
            "status":              status,
            "filing_date":         filing or "",
            "vienna_codes":        hit.get("vienna_codes", ""),
            "visual_score":        round(hit["score"], 3),
            "vienna_overlap":      round(hit.get("vienna_overlap", 0), 3),
            "combined_score":      round(hit["combined_score"], 3),
        })
        if len(results) >= top_k:
            break

    return JSONResponse({
        "predicted_vienna_signature": sorted(predicted_sig),
        "results": results,
    })
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
python -m pytest tests/test_server.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_server.py
git commit -m "feat: FastAPI search server with DINOv2 + Vienna re-ranking"
```

---

## Task 10: Docker Container + Cloud Run Deployment

> 🗣 **In plain English:** To run our Python server on Google Cloud, we need to package it into a "container" — a self-contained box that includes Python, all the libraries, and our code. This task creates that box definition (the Dockerfile) and deploys it to Cloud Run. After this step, you have a live URL that anyone with access can send images to.

**Files:**
- Create: `tools/trademark_image_search/server/Dockerfile`
- Create: `tools/trademark_image_search/server/.dockerignore`

- [ ] **Step 1: Create Dockerfile**

> 🗣 A Dockerfile is a recipe for building the container. We start from a standard Python image, install our libraries, copy our code in, and tell it to start the web server when the container launches.

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system deps needed by torch and lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements_server.txt .
RUN pip install --no-cache-dir -r requirements_server.txt

# Copy application code
COPY shared/ ./shared/
COPY setup/gcs_uploader.py ./setup/gcs_uploader.py
COPY setup/__init__.py ./setup/__init__.py
COPY server/main.py ./server/main.py

# Cloud Run expects the app on port 8080
ENV PORT=8080
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 2: Create .dockerignore**

```
__pycache__/
*.pyc
*.pyo
tests/
*.md
.git/
```

- [ ] **Step 3: Build and test the container locally**

> 🗣 Before deploying to Google Cloud, build the container on your own machine and make sure it starts up without errors. The `GCS_BUCKET` variable tells the server which Google Cloud Storage bucket to load data from.

```bash
cd tools/trademark_image_search
docker build -f server/Dockerfile -t trademark-search:local .
docker run -p 8080:8080 \
  -e GCS_BUCKET=YOUR_PROJECT_ID-trademark-search \
  -e GOOGLE_APPLICATION_CREDENTIALS=/tmp/key.json \
  trademark-search:local
```

Expected: Server starts, prints "Server ready." after downloading index files from GCS. Test with `curl http://localhost:8080/health` → `{"status":"ok","index_loaded":true}`

> Note: For local testing before GCS is populated, you can set `use_ivfpq=False` and build a tiny test index manually. Full test requires the index to be in GCS first (done in Task 11).

- [ ] **Step 4: Deploy to Cloud Run**

> 🗣 These three commands: (1) push the container to Google's container registry, (2) deploy it to Cloud Run with 4 GB RAM (enough for DINOv2 + compressed FAISS index), (3) set the GCS bucket environment variable so the server knows where to load data from.

```bash
# Set your project ID
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=us-central1

# Build and push container to Google's registry
gcloud builds submit --tag gcr.io/$PROJECT_ID/trademark-search .

# Deploy to Cloud Run (4 GB RAM, 1 CPU, max 3 instances)
gcloud run deploy trademark-search \
  --image gcr.io/$PROJECT_ID/trademark-search \
  --platform managed \
  --region $REGION \
  --memory 4Gi \
  --cpu 1 \
  --max-instances 3 \
  --timeout 120 \
  --set-env-vars GCS_BUCKET=$PROJECT_ID-trademark-search \
  --no-allow-unauthenticated
```

Expected output includes a service URL like:
`Service URL: https://trademark-search-xxxxxxxx-uc.a.run.app`

> `--no-allow-unauthenticated` means only people with Google Cloud access to your project can call the API. This keeps it private to you and your coworker.

- [ ] **Step 5: Grant your coworker access**

> 🗣 Replace `COWORKER_EMAIL` with your coworker's Google account email. This gives them permission to call the Cloud Run API.

```bash
gcloud run services add-iam-policy-binding trademark-search \
  --region $REGION \
  --member="user:COWORKER_EMAIL@gmail.com" \
  --role="roles/run.invoker"
```

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/.dockerignore
git commit -m "feat: Dockerfile + Cloud Run deployment for trademark search API"
```

---

## Task 11: One-Time Setup Script

> 🗣 **In plain English:** The script you (or whoever sets up the system) runs exactly once. It: (1) downloads USPTO data, (2) downloads trademark images, (3) runs DINOv2 to generate visual fingerprints, (4) builds the FAISS catalog, (5) uploads everything to Google Cloud Storage, (6) deletes the local images to reclaim disk space. After this script finishes, the Cloud Run server can start serving searches.

**Files:**
- Create: `tools/trademark_image_search/setup/run_setup.py`

- [ ] **Step 1: Implement run_setup.py**

```python
# setup/run_setup.py
"""
One-time setup script. Run this once to populate Google Cloud Storage
with the USPTO trademark index. After this, delete this file's artifacts locally.

Usage:
    python -m setup.run_setup --bucket YOUR_PROJECT_ID-trademark-search
    python -m setup.run_setup --bucket YOUR_PROJECT_ID-trademark-search --limit 5000
"""
import sqlite3
import sys
from pathlib import Path
import numpy as np
import click
from PIL import Image, UnidentifiedImageError

sys.path.insert(0, str(Path(__file__).parent.parent))

from setup.metadata_parser import parse_design_marks
from setup.image_downloader import download_all_images
from setup.gcs_uploader import upload_to_gcs
from shared.dinov2_embedder import DINOv2Embedder
from shared.faiss_index import TrademarkFAISSIndex

WORK_DIR     = Path.home() / ".trademark_setup"
DB_PATH      = WORK_DIR / "marks.db"
IMAGES_DIR   = WORK_DIR / "images"
INDEX_DIR    = WORK_DIR / "index"
SCHEMA       = Path(__file__).parent.parent / "shared" / "schema.sql"
BULK_XML_URL = "https://bulkdata.uspto.gov/data/trademark/brf_case_file_segments/"


def _download_bulk_xml(raw_dir: Path) -> list[Path]:
    import httpx, zipfile, re
    from tqdm import tqdm
    raw_dir.mkdir(parents=True, exist_ok=True)
    resp = httpx.get(BULK_XML_URL, timeout=30)
    resp.raise_for_status()
    zips = sorted(re.findall(r'href="(brf_case_file_\d{8}\.zip)"', resp.text))
    if not zips:
        raise RuntimeError(f"No ZIPs at {BULK_XML_URL}")
    url = BULK_XML_URL + zips[-1]
    zip_path = raw_dir / zips[-1]
    if not zip_path.exists():
        click.echo(f"Downloading {url} ...")
        with httpx.stream("GET", url, timeout=None, follow_redirects=True) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            with open(zip_path, "wb") as f:
                from tqdm import tqdm as _tqdm
                with _tqdm(total=total, unit="B", unit_scale=True) as bar:
                    for chunk in r.iter_bytes(65536):
                        f.write(chunk)
                        bar.update(len(chunk))
    xml_files = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith(".xml"):
                out = raw_dir / name
                if not out.exists():
                    zf.extract(name, raw_dir)
                xml_files.append(raw_dir / name)
    return xml_files


@click.command()
@click.option("--bucket", required=True, help="GCS bucket name (e.g. myproject-trademark-search)")
@click.option("--limit", default=0, help="Max marks to index (0 = all). Use 100 for a quick test.")
@click.option("--skip-upload", is_flag=True, help="Build index locally but don't upload (for testing)")
def main(bucket: str, limit: int, skip_upload: bool):
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    # Phase 1: Parse USPTO data
    click.echo("\n[1/5] Downloading USPTO bulk XML + parsing design marks with Vienna codes...")
    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript(SCHEMA.read_text())
    xml_files = _download_bulk_xml(WORK_DIR / "raw")
    total = sum(parse_design_marks(f, conn) for f in xml_files)
    click.echo(f"  {total:,} design marks with Vienna codes in database")

    # Phase 2: Download images
    click.echo("\n[2/5] Downloading trademark logo images (slow — can take days for full dataset)...")
    if limit:
        conn.execute(
            "UPDATE design_marks SET image_downloaded = 1 WHERE serial_number NOT IN "
            f"(SELECT serial_number FROM design_marks ORDER BY serial_number LIMIT {limit})"
        )
        conn.commit()
    stats = download_all_images(IMAGES_DIR, conn)
    click.echo(f"  Downloaded: {stats['downloaded']:,}  Skipped: {stats['skipped']:,}  Failed: {stats['failed']:,}")

    # Phase 3: Generate DINOv2 embeddings
    click.echo("\n[3/5] Generating DINOv2 visual fingerprints (runs locally)...")
    embedder    = DINOv2Embedder()
    image_files = list(IMAGES_DIR.glob("*.jpg"))
    embeddings, serials = [], []
    from tqdm import tqdm
    for img_path in tqdm(image_files, desc="Embedding", unit="img"):
        try:
            embeddings.append(embedder.embed_file(img_path))
            serials.append(img_path.stem)
        except (UnidentifiedImageError, Exception):
            pass
    click.echo(f"  {len(embeddings):,} images embedded")

    # Phase 4: Build IVFPQ FAISS index
    click.echo("\n[4/5] Building FAISS IVFPQ index (~400 MB compressed)...")
    all_vecs = np.stack(embeddings)
    idx = TrademarkFAISSIndex(dim=1024, use_ivfpq=True)
    click.echo("  Training IVFPQ clusters (requires min ~50K vectors for good quality)...")
    idx.train(all_vecs)
    batch = 10000
    for i in range(0, len(embeddings), batch):
        idx.add_batch(np.stack(embeddings[i:i+batch]), serials[i:i+batch])
    idx.save(INDEX_DIR)
    import shutil
    shutil.copy(DB_PATH, INDEX_DIR / "marks.db")
    click.echo(f"  Index saved to {INDEX_DIR}")

    # Phase 5: Upload to GCS
    if not skip_upload:
        click.echo(f"\n[5/5] Uploading to gs://{bucket} ...")
        upload_to_gcs(bucket, INDEX_DIR)
        click.echo(f"\n✅ Done. Deleting local images to reclaim disk space...")
        shutil.rmtree(IMAGES_DIR)
        click.echo(f"  Images deleted. Index remains at {INDEX_DIR} as local backup.")
    else:
        click.echo("\n[5/5] Skipped upload (--skip-upload flag set)")

    click.echo(f"\n✅ Setup complete. {len(embeddings):,} marks indexed and uploaded.")
    click.echo("Your Cloud Run server will load the index on next startup.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify import**

```bash
python -c "from setup.run_setup import main; print('run_setup.py imports OK')"
```

Expected: `run_setup.py imports OK`

- [ ] **Step 3: Dev mode smoke test**

> 🗣 Run the full pipeline with just 100 marks to verify everything works end-to-end before the multi-day full run.

```bash
python -m setup.run_setup --bucket YOUR_PROJECT_ID-trademark-search --limit 100
```

Expected: Downloads USPTO ZIP, parses marks, downloads 100 images, embeds with DINOv2, builds FAISS, uploads to GCS. Final: `✅ Setup complete. 100 marks indexed and uploaded.`

- [ ] **Step 4: Verify the Cloud Run server loads the test index**

```bash
# Redeploy / restart Cloud Run to pick up the new GCS data
gcloud run services update trademark-search --region us-central1

# Check health
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://YOUR-SERVICE-URL.a.run.app/health
```

Expected: `{"status":"ok","index_loaded":true}`

- [ ] **Step 5: Commit**

```bash
git add setup/run_setup.py
git commit -m "feat: one-time setup — build IVFPQ index + upload to GCS"
```

---

## Task 12: Local CLI

> 🗣 **In plain English:** The tiny tool you and your coworker use every day. It's just a messenger — takes your logo file, sends it to the Cloud Run API, and prints the results nicely. No AI, no database, no storage. Install it with two libraries (`pip install httpx click`) and a Cloud Run URL. That's the entire local footprint.

**Files:**
- Create: `tools/trademark_image_search/client/cli.py`

- [ ] **Step 1: Implement cli.py**

```python
# client/cli.py
"""
USPTO Trademark Image Search — Local CLI

Setup (one time):
    pip install httpx click
    gcloud auth login   (needed for authentication)

Usage:
    python cli.py search ./my_logo.png
    python cli.py search ./my_logo.png --live-only
    python cli.py search ./my_logo.png --top-k 20

Environment variable (or pass --api-url):
    export TRADEMARK_API_URL=https://YOUR-SERVICE-URL.a.run.app
"""
import os
import subprocess
import sys
from pathlib import Path
import click
import httpx

DEFAULT_API_URL = os.environ.get("TRADEMARK_API_URL", "")

_STATUS_ICON = {"LIVE": "🟢", "DEAD": "🔴", "PENDING": "🟡", "UNKNOWN": "⚪"}


def _get_auth_token() -> str:
    """Get a Google identity token for Cloud Run authentication."""
    try:
        result = subprocess.run(
            ["gcloud", "auth", "print-identity-token"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        click.echo("ERROR: Could not get Google auth token. Run `gcloud auth login` first.", err=True)
        sys.exit(1)


@click.group()
def cli():
    """Local USPTO trademark image search — all computation runs in Google Cloud."""


@cli.command()
@click.argument("image_path", type=click.Path(exists=True))
@click.option("--api-url",   default=DEFAULT_API_URL, help="Cloud Run service URL")
@click.option("--top-k",     default=10, show_default=True)
@click.option("--live-only", is_flag=True, help="Show only LIVE marks")
def search(image_path: str, api_url: str, top_k: int, live_only: bool):
    """Find USPTO design marks visually similar to IMAGE_PATH.

    Example: python cli.py search ./my_logo.png
    """
    if not api_url:
        raise click.ClickException(
            "API URL not set. Run:\n"
            "  export TRADEMARK_API_URL=https://YOUR-SERVICE-URL.a.run.app\n"
            "Or pass --api-url https://..."
        )

    token  = _get_auth_token()
    headers = {"Authorization": f"Bearer {token}"}

    click.echo(f"Sending {Path(image_path).name} to trademark search API...")
    with open(image_path, "rb") as f:
        try:
            resp = httpx.post(
                f"{api_url}/search",
                headers=headers,
                files={"image": (Path(image_path).name, f, "image/png")},
                params={"top_k": top_k, "live_only": live_only},
                timeout=120,  # Cold start can take ~60 seconds
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise click.ClickException("Request timed out. The server may be cold-starting — try again.")
        except httpx.HTTPStatusError as e:
            raise click.ClickException(f"API error {e.response.status_code}: {e.response.text}")

    data = resp.json()

    click.echo(f"\nLogo Trademark Search — {Path(image_path).name}")
    click.echo("─" * 60)
    click.echo("⚠️  Informational only — not legal advice. Consult a trademark attorney.\n")

    predicted = data.get("predicted_vienna_signature", [])
    if predicted:
        click.echo(f"Predicted Vienna design categories: {', '.join(predicted)}\n")

    results = data.get("results", [])
    if not results:
        click.echo("No marks found.")
        return

    for i, r in enumerate(results, 1):
        icon     = _STATUS_ICON.get(r.get("status", ""), "⚪")
        reg      = f"Reg #{r['registration_number']}" if r.get("registration_number") else f"Serial #{r['serial_number']}"
        combined = int(r.get("combined_score", 0) * 100)
        visual   = int(r.get("visual_score", 0) * 100)
        vienna   = int(r.get("vienna_overlap", 0) * 100)
        click.echo(f"#{i}  Combined: {combined}%  [Visual: {visual}% | Vienna: {vienna}%]  —  {reg}")
        click.echo(f"    Mark:   {r.get('mark_text', '(design only)')}")
        click.echo(f"    Owner:  {r.get('owner_name', 'Unknown')}")
        click.echo(f"    Class:  {r.get('nice_classes','—')}  |  Status: {icon} {r.get('status','')}  |  Filed: {r.get('filing_date','—')}")
        if r.get("vienna_codes"):
            click.echo(f"    Vienna: {r['vienna_codes']}")
        click.echo()


if __name__ == "__main__":
    cli()
```

- [ ] **Step 2: Install client deps**

```bash
pip install httpx click
```

- [ ] **Step 3: Set the API URL and do a live end-to-end test**

```bash
export TRADEMARK_API_URL=https://YOUR-SERVICE-URL.a.run.app
python client/cli.py search tests/fixtures/query_logo.png
```

Expected: Results appear with combined scores and Vienna codes. First run may take ~60 seconds (cold start). Subsequent runs: 2–5 seconds.

- [ ] **Step 4: Write coworker setup instructions**

> 🗣 Create a one-page README so your coworker can start searching in under 5 minutes.

Create `client/COWORKER_SETUP.md`:

```markdown
# Trademark Search — Setup (5 minutes)

## Prerequisites
- Python 3.11+
- Google account (must be granted access — ask Richard)

## Steps

1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
   Then run: `gcloud auth login`

2. Install the two required libraries:
   ```
   pip install httpx click
   ```

3. Set the API URL (add to your ~/.zshrc or ~/.bashrc):
   ```
   export TRADEMARK_API_URL=https://YOUR-SERVICE-URL.a.run.app
   ```

4. Search:
   ```
   python cli.py search ./your_logo.png
   ```

That's it. No models, no databases, no large downloads.
```

- [ ] **Step 5: Commit**

```bash
git add client/cli.py client/COWORKER_SETUP.md
git commit -m "feat: local CLI — sends image to Cloud Run, displays results"
```

---

## Self-Review

### Spec Coverage
| Requirement | Covered |
|---|---|
| Logo/image search | ✅ DINOv2 + FAISS on Cloud Run |
| Vienna code matching | ✅ Re-ranker on server |
| Nothing stored locally | ✅ CLI only needs httpx + click |
| Shareable with coworker | ✅ Same CLI + Cloud Run URL, IAM grant |
| Google Cloud architecture | ✅ Cloud Run + Cloud Storage |
| Privacy (logo stays in your cloud) | ✅ `--no-allow-unauthenticated`, your GCP project only |

### Type Consistency
- `DINOv2Embedder.embed_image/embed_file` — used in setup (Task 5), server (Task 9). Consistent.
- `TrademarkFAISSIndex.load/query` — built in setup (Task 11), loaded in server (Task 9). `use_ivfpq` flag consistent.
- `rerank_with_vienna` output keys (`combined_score`, `vienna_overlap`, `vienna_codes`) — server (Task 9) → CLI response (Task 12). Consistent.

---

## Resource Requirements

### Local machine (one-time setup only)
| Asset | Disk | Notes |
|---|---|---|
| USPTO XML + DB | ~8 GB | Delete after upload |
| Downloaded images | ~60 GB | Deleted automatically after embedding |
| DINOv2 model | ~1.1 GB | Stays in HuggingFace cache |
| FAISS index (local backup) | ~400 MB | Optional to keep |
| **Peak during setup** | **~70 GB** | Returns to ~1.5 GB after cleanup |

> 🗣 The large disk usage only happens during the one-time setup. After setup completes and uploads to GCS, the script deletes the images. Your local machine returns to essentially nothing.

### Local machine (daily use — you and coworker)
| Asset | Space | Notes |
|---|---|---|
| `cli.py` | ~5 KB | The search script |
| httpx + click | ~10 MB | The two libraries |
| **Total** | **~10 MB** | |

### Google Cloud (monthly cost)
| Service | Usage | Cost |
|---|---|---|
| Cloud Storage | ~15 GB (index + DB) | ~$0.30/month |
| Cloud Run | Runs only when searching | Free tier (2M req/month) |
| Artifact Registry | Docker image | ~$0.10/month |
| **Total** | | **~$0.40/month** |

### Time
| Phase | Time |
|---|---|
| USPTO XML download + parse | 30–60 min |
| Image download (~3M marks) | 5–7 days (unattended) |
| DINOv2 embedding | 40–100h CPU / 2–6h GPU |
| FAISS build + GCS upload | 30–60 min |
| Cloud Run cold start (first search) | ~60 seconds |
| Subsequent searches | 2–5 seconds |

**Dev mode:** `python -m setup.run_setup --bucket YOUR_BUCKET --limit 5000` completes in ~45 minutes and gives a working end-to-end system to evaluate before the full multi-day run.
