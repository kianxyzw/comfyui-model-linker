"""
User Overrides Module

Stores and retrieves user-selected replacements so future analyses
can auto-suggest or auto-resolve to the saved match.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from .matcher import normalize_filename


def _data_dir() -> str:
    """Return the directory path for storing persistence data."""
    # Place under the extension directory in a `data` subfolder
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    data = os.path.join(base, "data")
    os.makedirs(data, exist_ok=True)
    return data


def _overrides_path() -> str:
    return os.path.join(_data_dir(), "overrides.json")


def get_overrides_path() -> str:
    """Public helper to report the absolute path used for overrides.json."""
    return _overrides_path()


def _default_doc() -> Dict[str, Any]:
    return {"version": 1, "mappings": []}


def load_overrides() -> Dict[str, Any]:
    """Load overrides JSON; returns a dictionary with key 'mappings' (list)."""
    path = _overrides_path()
    try:
        if not os.path.exists(path):
            return _default_doc()
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
            # Basic shape validation
            if not isinstance(doc, dict) or "mappings" not in doc:
                return _default_doc()
            if not isinstance(doc["mappings"], list):
                doc["mappings"] = []
            return doc
    except Exception as e:
        logging.warning(f"Model Linker: Failed to load overrides: {e}")
        return _default_doc()


def _save_overrides(doc: Dict[str, Any]) -> None:
    path = _overrides_path()
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2)
        logging.info(f"Model Linker: Saved overrides to {path}")
    except Exception as e:
        logging.warning(f"Model Linker: Failed to save overrides: {e}")


def _make_keys(original_path: str, category: Optional[str]) -> List[str]:
    """
    Produce candidate keys for lookup.
    Primary: category + normalized filename; Fallback: any + normalized filename
    """
    filename = os.path.basename(original_path or "").strip()
    norm = normalize_filename(filename) if filename else ""
    cat = (category or "").strip().lower() or "any"
    if cat in ("unknown", "none", "undefined"):
        cat = "any"
    keys = [f"{cat}:{norm}"]
    if cat != "any":
        keys.append(f"any:{norm}")
    return keys


def find_override_path(original_path: str, category: Optional[str]) -> Optional[str]:
    """Return stored absolute path for a given (original_path, category), if any."""
    doc = load_overrides()
    keys = _make_keys(original_path, category)
    # Build quick lookup
    lookup: Dict[str, Dict[str, Any]] = {}
    for m in doc.get("mappings", []):
        k = m.get("key")
        if isinstance(k, str):
            lookup[k] = m
    for k in keys:
        m = lookup.get(k)
        if m and m.get("path"):
            return m.get("path")

    # Fallback: match by normalized filename regardless of saved category
    try:
        filename = os.path.basename(original_path or "").strip()
        norm = normalize_filename(filename) if filename else ""
        if norm:
            for m in doc.get("mappings", []):
                key = m.get("key") or ""
                if isinstance(key, str) and ":" in key:
                    _, saved_norm = key.split(":", 1)
                    if saved_norm == norm and m.get("path"):
                        return m.get("path")
    except Exception:
        pass
    return None


def find_override_model(original_path: str, category: Optional[str], available_models: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Return the model dict from available_models for a saved override, if present.
    """
    saved_path = find_override_path(original_path, category)
    if not saved_path:
        return None
    try:
        saved_norm = os.path.normpath(saved_path)
    except Exception:
        saved_norm = saved_path
    for m in available_models:
        p = m.get("path")
        try:
            if p and os.path.normpath(p) == saved_norm:
                return m
        except Exception:
            if p == saved_path:
                return m
    # If not found (file moved/removed), do not return stale override
    return None


def record_override(original_path: str, category: Optional[str], resolved: Dict[str, Any] | None = None, resolved_path: Optional[str] = None) -> bool:
    """
    Record a user-selected override.

    Args:
        original_path: original missing value from workflow
        category: model category if known
        resolved: model dict from scanner (preferred)
        resolved_path: absolute path if model dict not provided

    Returns:
        True if the override file was updated, else False.
    """
    path = None
    if isinstance(resolved, dict):
        path = resolved.get("path") or resolved_path
    else:
        path = resolved_path
    if not original_path or not path:
        return False

    filename = os.path.basename(original_path)
    key = _make_keys(original_path, category)[0]  # primary key (category-aware)

    # Normalize category consistently with _make_keys
    cat = (category or "").strip().lower() or "any"
    if cat in ("unknown", "none", "undefined"):
        cat = "any"

    entry: Dict[str, Any] = {
        "key": key,
        "original_filename": filename,
        "category": cat,
        "path": path,
    }
    # Optional metadata for convenience
    if isinstance(resolved, dict):
        for k in ("filename", "relative_path", "base_directory"):
            if k in resolved:
                entry[k] = resolved[k]

    doc = load_overrides()
    mappings = doc.get("mappings", [])
    # replace or append
    replaced = False
    for i, m in enumerate(mappings):
        if m.get("key") == key:
            mappings[i] = entry
            replaced = True
            break
    if not replaced:
        mappings.append(entry)
    doc["mappings"] = mappings
    _save_overrides(doc)
    return True
