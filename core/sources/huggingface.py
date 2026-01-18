"""
HuggingFace Source Module

Search and download models from HuggingFace Hub.
"""

import os
import re
import logging
import requests
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, quote

logger = logging.getLogger(__name__)

HF_API_URL = "https://huggingface.co/api"

# Cache for search results
_search_cache: Dict[str, Any] = {}


def parse_huggingface_url(url: str) -> Optional[Dict[str, str]]:
    """
    Parse a HuggingFace URL to extract repo and filename.
    
    Handles formats:
    - https://huggingface.co/user/repo/resolve/main/file.safetensors
    - https://huggingface.co/user/repo/blob/main/file.safetensors
    - hf://user/repo/file.safetensors
    
    Returns:
        Dictionary with 'repo' and 'filename' keys, or None if not HF URL
    """
    if url.startswith('hf://'):
        parts = url[5:].split('/', 2)
        if len(parts) >= 3:
            return {
                'repo': f"{parts[0]}/{parts[1]}",
                'filename': parts[2]
            }
        return None
    
    parsed = urlparse(url)
    if 'huggingface.co' not in parsed.netloc:
        return None
    
    match = re.match(r'^/([^/]+/[^/]+)/(resolve|blob)/([^/]+)/(.+)$', parsed.path)
    if match:
        return {
            'repo': match.group(1),
            'branch': match.group(3),
            'filename': match.group(4)
        }
    
    return None


def get_huggingface_download_url(repo: str, filename: str, branch: str = "main") -> str:
    """Generate a direct download URL for a HuggingFace file."""
    return f"https://huggingface.co/{repo}/resolve/{branch}/{quote(filename)}"


def clean_filename_for_search(filename: str) -> str:
    """
    Clean up filename for better search results.
    Remove common suffixes that might prevent matches.
    """
    base = os.path.splitext(filename)[0]
    # Remove common precision/format suffixes
    base = re.sub(r'[-_]?(fp16|fp32|fp8|bf16|e4m3fn|scaled|pruned|emaonly|q4|q8).*$', '', base, flags=re.IGNORECASE)
    return base


def search_huggingface_for_file(
    filename: str,
    token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Search HuggingFace for a specific model file.
    Returns the first repo that actually contains this exact file.
    
    Args:
        filename: Exact filename to search for
        token: Optional HF token
        
    Returns:
        Dict with url, repo, filename if found, None otherwise
    """
    global _search_cache
    
    cache_key = f"hf_{filename}"
    if cache_key in _search_cache:
        return _search_cache[cache_key]
    
    try:
        # Clean filename for search
        search_term = clean_filename_for_search(filename)
        
        headers = {}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        # Search for repos containing this filename
        search_url = f"{HF_API_URL}/models?search={quote(search_term)}&limit=10"
        
        response = requests.get(search_url, headers=headers, timeout=15)
        if response.status_code != 200:
            logger.debug(f"HuggingFace search returned {response.status_code}")
            return None
        
        repos = response.json()
        
        for repo in repos:
            repo_id = repo.get('id', '')
            if not repo_id:
                continue
            
            # Check if this repo actually has the exact file
            files_url = f"{HF_API_URL}/models/{repo_id}/tree/main"
            
            try:
                files_response = requests.get(files_url, headers=headers, timeout=10)
                if files_response.status_code == 200:
                    files = files_response.json()
                    
                    for file_info in files:
                        file_path = file_info.get('path', '')
                        # Check for exact filename match (case-insensitive)
                        if file_path.lower().endswith(filename.lower()):
                            result = {
                                'source': 'huggingface',
                                'repo': repo_id,
                                'filename': os.path.basename(file_path),
                                'path': file_path,
                                'url': get_huggingface_download_url(repo_id, file_path),
                                'size': file_info.get('size')
                            }
                            _search_cache[cache_key] = result
                            logger.info(f"Found {filename} on HuggingFace: {repo_id}")
                            return result
                            
            except Exception as e:
                logger.debug(f"Error checking repo {repo_id}: {e}")
                continue
        
        # Not found
        _search_cache[cache_key] = None
        return None
        
    except Exception as e:
        logger.error(f"HuggingFace search error: {e}")
        return None


def search_huggingface(
    query: str,
    model_type: Optional[str] = None,
    limit: int = 10,
    token: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Search HuggingFace Hub for models (general search).
    Returns repos that might be relevant, not guaranteed to have exact file.
    """
    results = []
    
    try:
        headers = {}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        params = {
            'search': query,
            'limit': limit,
            'full': 'true'
        }
        
        response = requests.get(
            f"{HF_API_URL}/models",
            params=params,
            headers=headers,
            timeout=15
        )
        
        if response.status_code == 200:
            models = response.json()
            
            for model in models:
                repo_id = model.get('id', '')
                
                results.append({
                    'source': 'huggingface',
                    'repo': repo_id,
                    'name': model.get('modelId', repo_id),
                    'downloads': model.get('downloads', 0),
                    'likes': model.get('likes', 0),
                    'url': f"https://huggingface.co/{repo_id}"
                })
                
    except Exception as e:
        logger.error(f"HuggingFace search error: {e}")
    
    return results


def get_repo_files(
    repo: str,
    token: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get list of model files in a HuggingFace repo."""
    files = []
    
    try:
        headers = {}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        response = requests.get(
            f"{HF_API_URL}/models/{repo}/tree/main",
            headers=headers,
            timeout=15
        )
        
        if response.status_code == 200:
            items = response.json()
            
            for item in items:
                path = item.get('path', '')
                if path.endswith(('.safetensors', '.ckpt', '.pt', '.bin', '.pth', '.onnx')):
                    files.append({
                        'filename': os.path.basename(path),
                        'path': path,
                        'url': get_huggingface_download_url(repo, path),
                        'size': item.get('size')
                    })
                    
    except Exception as e:
        logger.error(f"Error getting repo files: {e}")
    
    return files
