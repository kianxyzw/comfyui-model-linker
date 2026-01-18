"""
CivitAI Source Module

Search and download models from CivitAI.
"""

import os
import re
import logging
import requests
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, parse_qs, quote

logger = logging.getLogger(__name__)

CIVITAI_API_URL = "https://civitai.com/api/v1"

# Cache for search results
_search_cache: Dict[str, Any] = {}


def parse_civitai_url(url: str) -> Optional[Dict[str, Any]]:
    """
    Parse a CivitAI URL to extract model/version info.
    """
    parsed = urlparse(url)
    if 'civitai.com' not in parsed.netloc:
        return None
    
    if '/api/download/models/' in parsed.path:
        match = re.search(r'/api/download/models/(\d+)', parsed.path)
        if match:
            return {'version_id': int(match.group(1))}
    
    match = re.search(r'/models/(\d+)', parsed.path)
    if match:
        result = {'model_id': int(match.group(1))}
        query = parse_qs(parsed.query)
        if 'modelVersionId' in query:
            result['version_id'] = int(query['modelVersionId'][0])
        return result
    
    return None


def get_civitai_download_url(version_id: int, api_key: Optional[str] = None) -> str:
    """Get download URL for a CivitAI model version."""
    url = f"https://civitai.com/api/download/models/{version_id}"
    if api_key:
        url += f"?token={api_key}"
    return url


def clean_filename_for_search(filename: str) -> str:
    """
    Clean up filename for better CivitAI search results.
    Remove common suffixes that might prevent matches.
    """
    base = os.path.splitext(filename)[0]
    # Remove common precision/format suffixes
    base = re.sub(r'[-_]?(fp16|fp32|fp8|bf16|e4m3fn|scaled|pruned|emaonly|q4|q8).*$', '', base, flags=re.IGNORECASE)
    # Remove version numbers at end
    base = re.sub(r'[-_]?v?\d+(\.\d+)*$', '', base, flags=re.IGNORECASE)
    return base


def search_civitai_for_file(
    filename: str,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Search CivitAI for a specific model file.
    Returns the first model that actually has this exact filename.
    
    Args:
        filename: Exact filename to search for
        api_key: Optional API key
        
    Returns:
        Dict with download info if found, None otherwise
    """
    global _search_cache
    
    cache_key = f"civit_{filename}"
    if cache_key in _search_cache:
        return _search_cache[cache_key]
    
    try:
        # Clean filename for search
        search_term = clean_filename_for_search(filename)
        
        headers = {}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        
        search_url = f"{CIVITAI_API_URL}/models?query={quote(search_term)}&limit=10"
        
        response = requests.get(search_url, headers=headers, timeout=15)
        if response.status_code != 200:
            logger.debug(f"CivitAI search returned {response.status_code}")
            return None
        
        data = response.json()
        items = data.get('items', [])
        
        for item in items:
            model_id = item.get('id')
            model_name = item.get('name', '')
            model_type = item.get('type', '')
            
            model_versions = item.get('modelVersions', [])
            for version in model_versions:
                version_id = version.get('id')
                files = version.get('files', [])
                
                for file_info in files:
                    file_name = file_info.get('name', '')
                    # Check for exact filename match (case-insensitive)
                    if file_name.lower() == filename.lower():
                        download_url = file_info.get('downloadUrl', '')
                        if download_url:
                            result = {
                                'source': 'civitai',
                                'model_id': model_id,
                                'version_id': version_id,
                                'name': model_name,
                                'type': model_type,
                                'filename': file_name,
                                'url': f"https://civitai.com/models/{model_id}",
                                'download_url': download_url,
                                'size': file_info.get('sizeKB', 0) * 1024
                            }
                            _search_cache[cache_key] = result
                            logger.info(f"Found {filename} on CivitAI: {model_name}")
                            return result
        
        # Not found
        _search_cache[cache_key] = None
        return None
        
    except Exception as e:
        logger.error(f"CivitAI search error: {e}")
        return None


def search_civitai(
    query: str,
    model_type: Optional[str] = None,
    limit: int = 10,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Search CivitAI for models (general search).
    Returns models that might be relevant.
    """
    results = []
    
    type_map = {
        'checkpoint': 'Checkpoint',
        'checkpoints': 'Checkpoint',
        'lora': 'LORA',
        'loras': 'LORA',
        'vae': 'VAE',
        'controlnet': 'Controlnet',
        'embedding': 'TextualInversion',
        'embeddings': 'TextualInversion',
        'upscaler': 'Upscaler',
        'upscale_models': 'Upscaler',
    }
    
    try:
        params = {
            'query': query,
            'limit': limit,
            'nsfw': 'false'
        }
        
        if model_type:
            civitai_type = type_map.get(model_type.lower())
            if civitai_type:
                params['types'] = civitai_type
        
        headers = {}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        
        response = requests.get(
            f"{CIVITAI_API_URL}/models",
            params=params,
            headers=headers,
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            
            for model in data.get('items', []):
                model_id = model.get('id')
                model_name = model.get('name', '')
                model_type = model.get('type', '')
                
                versions = model.get('modelVersions', [])
                if versions:
                    latest = versions[0]
                    version_id = latest.get('id')
                    
                    files = latest.get('files', [])
                    primary_file = None
                    for f in files:
                        if f.get('primary', False) or f.get('type') == 'Model':
                            primary_file = f
                            break
                    
                    if not primary_file and files:
                        primary_file = files[0]
                    
                    result = {
                        'source': 'civitai',
                        'model_id': model_id,
                        'version_id': version_id,
                        'name': model_name,
                        'type': model_type,
                        'url': f"https://civitai.com/models/{model_id}",
                        'download_url': get_civitai_download_url(version_id, api_key),
                        'downloads': model.get('stats', {}).get('downloadCount', 0),
                    }
                    
                    if primary_file:
                        result['filename'] = primary_file.get('name', '')
                        result['size'] = primary_file.get('sizeKB', 0) * 1024
                    
                    results.append(result)
                    
    except Exception as e:
        logger.error(f"CivitAI search error: {e}")
    
    return results


def search_civitai_by_hash(
    hash_value: str,
    api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Look up a model by file hash on CivitAI."""
    try:
        headers = {}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        
        response = requests.get(
            f"{CIVITAI_API_URL}/model-versions/by-hash/{hash_value}",
            headers=headers,
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            
            model_id = data.get('modelId')
            version_id = data.get('id')
            files = data.get('files', [])
            primary_file = files[0] if files else {}
            
            return {
                'source': 'civitai',
                'model_id': model_id,
                'version_id': version_id,
                'name': data.get('model', {}).get('name', ''),
                'url': f"https://civitai.com/models/{model_id}",
                'download_url': get_civitai_download_url(version_id, api_key),
                'filename': primary_file.get('name', ''),
                'size': primary_file.get('sizeKB', 0) * 1024
            }
            
    except Exception as e:
        logger.error(f"CivitAI hash lookup error: {e}")
    
    return None
