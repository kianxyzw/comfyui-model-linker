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
    token: Optional[str] = None,
    exact_only: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Search HuggingFace for a specific model file.
    Returns the first repo that contains a matching file.
    
    Args:
        filename: Filename to search for
        token: Optional HF token
        exact_only: If True, only return exact filename matches (for downloads).
                   If False, also try partial matching (for local file resolution).
        
    Returns:
        Dict with url, repo, filename if found, None otherwise
    """
    global _search_cache
    
    cache_key = f"hf_{filename}_exact{exact_only}"
    if cache_key in _search_cache:
        return _search_cache[cache_key]
    
    try:
        # Use filename without extension for search
        filename_base = os.path.splitext(filename)[0].lower()
        
        headers = {}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        # Search for repos containing this filename
        search_url = f"{HF_API_URL}/models?search={quote(filename_base)}&limit=10"
        
        response = requests.get(search_url, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.debug(f"HuggingFace search returned {response.status_code}")
            return None
        
        repos = response.json()
        
        for repo in repos:
            repo_id = repo.get('id', '')
            if not repo_id:
                continue
            
            # Check if this repo actually has a matching file
            files_url = f"{HF_API_URL}/models/{repo_id}/tree/main"
            
            try:
                files_response = requests.get(files_url, headers=headers, timeout=10)
                if files_response.status_code == 200:
                    files = files_response.json()
                    
                    for file_info in files:
                        file_path = file_info.get('path', '')
                        file_base = os.path.splitext(os.path.basename(file_path))[0].lower()
                        
                        # Check for exact match first (always try this)
                        if file_path.endswith(filename):
                            result = {
                                'source': 'huggingface',
                                'repo_id': repo_id,
                                'filename': os.path.basename(file_path),
                                'path': file_path,
                                'url': get_huggingface_download_url(repo_id, file_path),
                                'size': file_info.get('size'),
                                'match_type': 'exact'
                            }
                            _search_cache[cache_key] = result
                            logger.info(f"Found {filename} on HuggingFace: {repo_id}")
                            return result
                        
                        # Check for partial match (filename_base in file_base or vice versa)
                        # Skip partial matches if exact_only is True - prevents confusing
                        # users with wrong model suggestions for downloads
                        if not exact_only:
                            if filename_base in file_base or file_base in filename_base:
                                if file_path.endswith('.safetensors') or file_path.endswith('.ckpt'):
                                    result = {
                                        'source': 'huggingface',
                                        'repo_id': repo_id,
                                        'filename': os.path.basename(file_path),
                                        'path': file_path,
                                        'url': get_huggingface_download_url(repo_id, file_path),
                                        'size': file_info.get('size'),
                                        'match_type': 'partial'
                                    }
                                    _search_cache[cache_key] = result
                                    logger.info(f"Found similar file for {filename} on HuggingFace: {repo_id}/{file_path}")
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
