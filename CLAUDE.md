# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComfyUI Model Linker is a ComfyUI extension that helps users relink missing models in workflows. It scans workflow nodes for model references that no longer exist on disk, uses fuzzy matching (via `difflib.SequenceMatcher`) to suggest replacements, and remembers user selections as persistent overrides.

This is **not** a custom node — it provides no `NODE_CLASS_MAPPINGS`. It registers API routes on `PromptServer` and loads a web UI via `WEB_DIRECTORY`.

## Development Environment

- **Python >=3.8**, no external dependencies beyond ComfyUI's own (aiohttp, folder_paths, server)
- **JavaScript**: ES6 modules loaded by ComfyUI from `web/`
- **Activate venv**: `call c:\ComfyUI\.venv\Scripts\activate`
- **No test suite, no linter, no build step** — the extension is loaded directly by ComfyUI at startup
- **To test changes**: restart ComfyUI (Python changes) or hard-refresh the browser (JS changes)

## Architecture

### Data Flow
```
Frontend (linker.js) → POST /model_linker/analyze → core/linker.py
  → workflow_analyzer.py extracts model refs from all nodes (including subgraphs)
  → scanner.py finds available models via ComfyUI's folder_paths
  → matcher.py fuzzy-matches missing models to available ones
  → overrides.py checks for saved user preferences
  → Returns missing models with ranked suggestions to frontend

Frontend → POST /model_linker/resolve → core/linker.py
  → workflow_updater.py patches the workflow JSON
  → overrides.py persists user selections to data/overrides.json
```

### Key Modules

| Module | Responsibility |
|---|---|
| `__init__.py` | Extension entry point; registers 7 aiohttp API routes on `PromptServer` |
| `core/linker.py` | High-level API: `analyze_and_find_matches()`, `apply_resolution()` |
| `core/scanner.py` | Discovers model files using ComfyUI's `folder_paths` |
| `core/matcher.py` | Fuzzy matching with filename normalization (removes extensions, normalizes separators) |
| `core/workflow_analyzer.py` | Extracts model references from workflow JSON, handles subgraph definitions |
| `core/workflow_updater.py` | Patches `widgets_values` in workflow nodes, supports subgraph nodes |
| `core/overrides.py` | CRUD for `data/overrides.json` — persistent user model selections |
| `web/linker.js` | Full frontend: modal dialog, toolbar button, model search/dropdown, overrides manager |

### API Routes

All routes are prefixed `/model_linker/`:
- `POST /analyze` — analyze workflow for missing models
- `POST /resolve` — apply selected resolutions to workflow
- `GET /models` — list all available models
- `GET /overrides` — get saved overrides
- `POST /overrides/delete` — delete single override by key
- `POST /overrides/clear` — clear all overrides
- `POST /overrides/replace` — replace entire overrides document

## Critical Conventions

### Path Handling (Windows/Unix compatibility)
- **Always use `os.path` methods** — never hardcode separators or normalize to forward slashes
- ComfyUI uses OS-native separators; the extension must match this behavior
- Model deduplication compares absolute paths via `os.path.normpath()` to detect symlink duplicates
- Filename splitting uses regex `[/\\]` to handle both separators in stored paths

### Fuzzy Matching
- Filenames are normalized: lowercase, extensions removed, `_-` converted to spaces
- Scores are capped at 0.999 for non-exact matches to distinguish from true 100% matches
- Override matches get 99-100% confidence to appear at the top
- Minimum threshold is 70% confidence

### Frontend (linker.js)
- Uses ComfyUI's `$el()` helper for DOM creation, not raw HTML
- CSS is scoped with specific IDs/classes prefixed `model-linker-` to avoid ComfyUI style conflicts
- Modal position/size persists via `localStorage`
- Imports from ComfyUI relative paths: `../../scripts/app.js`, `../../scripts/api.js`, `../../scripts/ui.js`

### Overrides Persistence
- Stored at `data/overrides.json` (gitignored)
- Format: `{version: 1, mappings: [{key: "category:normalized_name", path: "...", ...}]}`
- Keys are `category:normalized_filename` for category-specific lookup
