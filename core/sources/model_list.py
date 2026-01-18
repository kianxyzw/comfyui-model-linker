"""
Model List Database Module

Search the ComfyUI Manager model-list.json database with fuzzy matching.
"""

import os
import json
import logging
from typing import Dict, Any, Optional, List
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

# Path to metadata directory
METADATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'metadata')
MODEL_LIST_FILE = os.path.join(METADATA_DIR, 'model-list.json')

# Cache for loaded data
_model_list_cache: Optional[List[Dict]] = None


def _load_model_list() -> List[Dict]:
    """Load model list database."""
    global _model_list_cache
    
    if _model_list_cache is not None:
        return _model_list_cache
    
    try:
        if os.path.exists(MODEL_LIST_FILE):
            with open(MODEL_LIST_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                _model_list_cache = data.get('models', [])
                logger.info(f"Loaded {len(_model_list_cache)} models from model-list.json")
                return _model_list_cache
    except Exception as e:
        logger.error(f"Error loading model list: {e}")
    
    _model_list_cache = []
    return _model_list_cache


def _normalize_filename(filename: str) -> str:
    """Normalize filename for comparison."""
    # Remove extension
    base = os.path.splitext(filename)[0].lower()
    # Replace separators with spaces
    base = base.replace('-', ' ').replace('_', ' ').replace('.', ' ')
    return base


def _similarity(a: str, b: str) -> float:
    """Calculate similarity between two strings."""
    return SequenceMatcher(None, a, b).ratio()


def search_model_list(filename: str) -> Optional[Dict[str, Any]]:
    """
    Search model-list.json for a model by filename.
    Uses exact match first, then fuzzy matching.
    
    Args:
        filename: Model filename to search for
        
    Returns:
        Dict with url, filename, type, etc. if found, None otherwise
    """
    models = _load_model_list()
    if not models:
        return None
    
    filename_lower = filename.lower()
    filename_base = os.path.splitext(filename_lower)[0]
    filename_norm = _normalize_filename(filename)
    
    # 1. Exact match first
    for model in models:
        model_filename = model.get('filename', '')
        if model_filename.lower() == filename_lower:
            url = model.get('url', '')
            if url:
                return {
                    'source': 'model_list',
                    'filename': model_filename,
                    'url': url,
                    'name': model.get('name', ''),
                    'type': model.get('type', ''),
                    'directory': model.get('save_path', 'checkpoints'),
                    'size': model.get('size', ''),
                    'match_type': 'exact'
                }
    
    # 2. Fuzzy substring match - check if filename contains or is contained by model name
    best_match = None
    best_score = 0.0
    
    for model in models:
        model_filename = model.get('filename', '')
        if not model_filename:
            continue
            
        model_base = os.path.splitext(model_filename.lower())[0]
        model_norm = _normalize_filename(model_filename)
        
        # Check substring matches (like WMD does)
        if filename_base in model_base or model_base in filename_base:
            url = model.get('url', '')
            if url:
                # Calculate similarity score
                score = _similarity(filename_norm, model_norm)
                if score > best_score:
                    best_score = score
                    best_match = {
                        'source': 'model_list',
                        'filename': model_filename,
                        'url': url,
                        'name': model.get('name', ''),
                        'type': model.get('type', ''),
                        'directory': model.get('save_path', 'checkpoints'),
                        'size': model.get('size', ''),
                        'match_type': 'fuzzy',
                        'confidence': round(score * 100, 1)
                    }
    
    # Return best fuzzy match if score is good enough (>50%)
    if best_match and best_score > 0.5:
        return best_match
    
    # 3. Try normalized similarity matching on all models
    for model in models:
        model_filename = model.get('filename', '')
        if not model_filename:
            continue
            
        model_norm = _normalize_filename(model_filename)
        score = _similarity(filename_norm, model_norm)
        
        if score > best_score and score > 0.6:  # Require 60% similarity
            url = model.get('url', '')
            if url:
                best_score = score
                best_match = {
                    'source': 'model_list',
                    'filename': model_filename,
                    'url': url,
                    'name': model.get('name', ''),
                    'type': model.get('type', ''),
                    'directory': model.get('save_path', 'checkpoints'),
                    'size': model.get('size', ''),
                    'match_type': 'similar',
                    'confidence': round(score * 100, 1)
                }
    
    return best_match


def search_model_list_multiple(filename: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Search model-list.json and return multiple fuzzy matches.
    
    Args:
        filename: Model filename to search for
        limit: Maximum results to return
        
    Returns:
        List of matching models sorted by relevance
    """
    models = _load_model_list()
    if not models:
        return []
    
    filename_norm = _normalize_filename(filename)
    results = []
    
    for model in models:
        model_filename = model.get('filename', '')
        if not model_filename:
            continue
            
        model_norm = _normalize_filename(model_filename)
        score = _similarity(filename_norm, model_norm)
        
        if score > 0.4:  # Minimum 40% similarity
            url = model.get('url', '')
            if url:
                results.append({
                    'source': 'model_list',
                    'filename': model_filename,
                    'url': url,
                    'name': model.get('name', ''),
                    'type': model.get('type', ''),
                    'directory': model.get('save_path', 'checkpoints'),
                    'size': model.get('size', ''),
                    'confidence': round(score * 100, 1)
                })
    
    # Sort by confidence descending
    results.sort(key=lambda x: x['confidence'], reverse=True)
    
    return results[:limit]


def reload_model_list():
    """Force reload of model list."""
    global _model_list_cache
    _model_list_cache = None
    _load_model_list()
