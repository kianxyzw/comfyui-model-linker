"""
Popular Models Database

Curated list of common models with known download URLs.
"""

import os
import json
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Path to metadata directory
METADATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'metadata')
POPULAR_MODELS_FILE = os.path.join(METADATA_DIR, 'popular-models.json')
MODEL_ALIASES_FILE = os.path.join(METADATA_DIR, 'model-aliases.json')

# Cache for loaded data
_popular_models_cache: Optional[Dict] = None
_model_aliases_cache: Optional[Dict] = None


def _load_popular_models() -> Dict[str, Any]:
    """Load popular models database."""
    global _popular_models_cache
    
    if _popular_models_cache is not None:
        return _popular_models_cache
    
    try:
        if os.path.exists(POPULAR_MODELS_FILE):
            with open(POPULAR_MODELS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                _popular_models_cache = data.get('models', {})
                return _popular_models_cache
    except Exception as e:
        logger.error(f"Error loading popular models: {e}")
    
    _popular_models_cache = {}
    return _popular_models_cache


def _load_model_aliases() -> Dict[str, List[str]]:
    """Load model aliases database."""
    global _model_aliases_cache
    
    if _model_aliases_cache is not None:
        return _model_aliases_cache
    
    try:
        if os.path.exists(MODEL_ALIASES_FILE):
            with open(MODEL_ALIASES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                _model_aliases_cache = data.get('aliases', {})
                return _model_aliases_cache
    except Exception as e:
        logger.error(f"Error loading model aliases: {e}")
    
    _model_aliases_cache = {}
    return _model_aliases_cache


def get_popular_model_url(filename: str) -> Optional[Dict[str, Any]]:
    """
    Look up a model filename in the popular models database.
    
    Args:
        filename: Model filename to look up
        
    Returns:
        Dictionary with url, type, directory if found, None otherwise
    """
    models = _load_popular_models()
    
    # Direct lookup
    if filename in models:
        return models[filename].copy()
    
    # Try lowercase
    filename_lower = filename.lower()
    for name, info in models.items():
        if name.lower() == filename_lower:
            return info.copy()
    
    # Try aliases
    aliases = _load_model_aliases()
    for canonical, alias_list in aliases.items():
        if filename in alias_list or filename_lower in [a.lower() for a in alias_list]:
            if canonical in models:
                result = models[canonical].copy()
                result['canonical_name'] = canonical
                return result
    
    return None


def search_popular_models(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Search popular models database by filename pattern.
    
    Args:
        query: Search query (partial filename)
        limit: Maximum results to return
        
    Returns:
        List of matching models with url info
    """
    models = _load_popular_models()
    query_lower = query.lower()
    
    results = []
    for name, info in models.items():
        if query_lower in name.lower():
            result = info.copy()
            result['filename'] = name
            results.append(result)
            
            if len(results) >= limit:
                break
    
    return results


def get_all_popular_models() -> Dict[str, Any]:
    """Get all popular models."""
    return _load_popular_models().copy()


def reload_databases():
    """Force reload of all databases."""
    global _popular_models_cache, _model_aliases_cache
    _popular_models_cache = None
    _model_aliases_cache = None
    _load_popular_models()
    _load_model_aliases()
