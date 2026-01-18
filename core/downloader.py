"""
Model Downloader Module

Handles downloading models from various sources with progress tracking.
"""

import os
import logging
import threading
import time
import requests
from typing import Dict, Any, Optional, Callable
from pathlib import Path

try:
    import folder_paths
except ImportError:
    folder_paths = None

# Download state tracking
download_progress: Dict[str, Dict[str, Any]] = {}
download_lock = threading.Lock()
cancelled_downloads: set = set()

logger = logging.getLogger(__name__)


def get_download_directory(category: str) -> Optional[str]:
    """
    Get the appropriate download directory for a model category.
    
    Args:
        category: Model category (e.g., 'checkpoints', 'loras', 'vae')
        
    Returns:
        Absolute path to the download directory, or None if not found
    """
    if folder_paths is None:
        return None
    
    # Map common category names to folder_paths keys
    category_map = {
        'checkpoint': 'checkpoints',
        'checkpoints': 'checkpoints',
        'lora': 'loras',
        'loras': 'loras',
        'vae': 'vae',
        'controlnet': 'controlnet',
        'clip': 'clip',
        'clip_vision': 'clip_vision',
        'upscaler': 'upscale_models',
        'upscale_models': 'upscale_models',
        'embeddings': 'embeddings',
        'embedding': 'embeddings',
        'diffusion_models': 'diffusion_models',
        'unet': 'diffusion_models',
        'text_encoders': 'text_encoders',
        'text_encoder': 'text_encoders',
        'ipadapter': 'ipadapter',
        'ip-adapter': 'ipadapter',
    }
    
    folder_key = category_map.get(category.lower(), category.lower())
    
    try:
        paths = folder_paths.get_folder_paths(folder_key)
        if paths:
            # Return the first path (usually the main models directory)
            return paths[0]
    except Exception as e:
        logger.debug(f"Could not get folder path for {folder_key}: {e}")
    
    return None


def generate_download_id() -> str:
    """Generate a unique download ID."""
    import uuid
    return str(uuid.uuid4())[:8]


def download_file(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    chunk_size: int = 8192,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> Dict[str, Any]:
    """
    Download a file from URL with progress tracking.
    
    Args:
        url: URL to download from
        dest_path: Destination file path
        download_id: Unique ID for tracking this download
        headers: Optional HTTP headers (for auth tokens)
        chunk_size: Download chunk size in bytes
        progress_callback: Optional callback(downloaded_bytes, total_bytes)
        
    Returns:
        Result dictionary with status and info
    """
    global download_progress, cancelled_downloads
    
    result = {
        'success': False,
        'download_id': download_id,
        'path': dest_path,
        'error': None,
        'size': 0
    }
    
    # Initialize progress tracking
    with download_lock:
        download_progress[download_id] = {
            'status': 'starting',
            'progress': 0,
            'total_size': 0,
            'downloaded': 0,
            'filename': os.path.basename(dest_path),
            'url': url,
            'error': None
        }
    
    try:
        # Ensure destination directory exists
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        
        # Start download
        response = requests.get(
            url,
            headers=headers,
            stream=True,
            timeout=30
        )
        response.raise_for_status()
        
        # Get total size
        total_size = int(response.headers.get('content-length', 0))
        
        with download_lock:
            download_progress[download_id]['total_size'] = total_size
            download_progress[download_id]['status'] = 'downloading'
        
        downloaded = 0
        
        # Download with progress
        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                # Check for cancellation
                if download_id in cancelled_downloads:
                    with download_lock:
                        download_progress[download_id]['status'] = 'cancelled'
                    # Clean up partial file
                    try:
                        os.remove(dest_path)
                    except:
                        pass
                    result['error'] = 'Download cancelled'
                    return result
                
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    
                    # Update progress
                    with download_lock:
                        download_progress[download_id]['downloaded'] = downloaded
                        if total_size > 0:
                            download_progress[download_id]['progress'] = int((downloaded / total_size) * 100)
                    
                    if progress_callback:
                        progress_callback(downloaded, total_size)
        
        # Success
        with download_lock:
            download_progress[download_id]['status'] = 'completed'
            download_progress[download_id]['progress'] = 100
        
        result['success'] = True
        result['size'] = downloaded
        
    except requests.exceptions.RequestException as e:
        error_msg = str(e)
        with download_lock:
            download_progress[download_id]['status'] = 'error'
            download_progress[download_id]['error'] = error_msg
        result['error'] = error_msg
        
        # Clean up partial file
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except:
            pass
            
    except Exception as e:
        error_msg = str(e)
        with download_lock:
            download_progress[download_id]['status'] = 'error'
            download_progress[download_id]['error'] = error_msg
        result['error'] = error_msg
        logger.error(f"Download error: {e}", exc_info=True)
    
    return result


def download_model(
    url: str,
    filename: str,
    category: str,
    download_id: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    subfolder: str = ""
) -> Dict[str, Any]:
    """
    Download a model to the appropriate directory.
    
    Args:
        url: URL to download from
        filename: Filename to save as
        category: Model category for directory selection
        download_id: Optional download ID (generated if not provided)
        headers: Optional HTTP headers
        subfolder: Optional subfolder within category directory
        
    Returns:
        Result dictionary
    """
    if download_id is None:
        download_id = generate_download_id()
    
    # Get destination directory
    dest_dir = get_download_directory(category)
    if not dest_dir:
        return {
            'success': False,
            'download_id': download_id,
            'error': f'Could not find directory for category: {category}'
        }
    
    # Add subfolder if specified
    if subfolder:
        dest_dir = os.path.join(dest_dir, subfolder)
    
    dest_path = os.path.join(dest_dir, filename)
    
    # Check if file already exists
    if os.path.exists(dest_path):
        return {
            'success': False,
            'download_id': download_id,
            'error': f'File already exists: {dest_path}',
            'path': dest_path
        }
    
    return download_file(url, dest_path, download_id, headers)


def get_progress(download_id: str) -> Optional[Dict[str, Any]]:
    """Get progress for a specific download."""
    with download_lock:
        return download_progress.get(download_id, {}).copy()


def get_all_progress() -> Dict[str, Dict[str, Any]]:
    """Get progress for all downloads."""
    with download_lock:
        return {k: v.copy() for k, v in download_progress.items()}


def cancel_download(download_id: str) -> bool:
    """Cancel a download in progress."""
    cancelled_downloads.add(download_id)
    return True


def clear_completed_downloads():
    """Clear completed/failed downloads from progress tracking."""
    with download_lock:
        to_remove = [
            did for did, info in download_progress.items()
            if info.get('status') in ('completed', 'error', 'cancelled')
        ]
        for did in to_remove:
            del download_progress[did]
            cancelled_downloads.discard(did)


def start_background_download(
    url: str,
    filename: str,
    category: str,
    headers: Optional[Dict[str, str]] = None,
    subfolder: str = ""
) -> str:
    """
    Start a download in a background thread.
    
    Returns:
        download_id for tracking progress
    """
    download_id = generate_download_id()
    
    def run_download():
        download_model(url, filename, category, download_id, headers, subfolder)
    
    thread = threading.Thread(target=run_download, daemon=True)
    thread.start()
    
    return download_id
