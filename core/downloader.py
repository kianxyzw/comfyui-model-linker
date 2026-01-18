"""
Model Downloader Module

Handles downloading models from various sources with progress tracking.
"""

import os
import logging
import threading
import time
import requests
from typing import Dict, Any, Optional, Callable, List
from pathlib import Path
from collections import deque

try:
    import folder_paths
except ImportError:
    folder_paths = None

# Download state tracking
download_progress: Dict[str, Dict[str, Any]] = {}
download_lock = threading.Lock()
cancelled_downloads: set = set()

# Speed calculation settings
SPEED_HISTORY_SIZE = 5  # Number of samples for smoothing
CHUNK_SIZE = 1024 * 1024  # 1MB chunks for faster downloads
CLI_LOG_INTERVAL = 5  # Log progress to CLI every N seconds

logger = logging.getLogger(__name__)


def format_bytes(bytes_value: int) -> str:
    """Format bytes to human readable string (e.g., 1.5 GB)."""
    if bytes_value == 0:
        return "0 B"
    k = 1024
    sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    i = 0
    while bytes_value >= k and i < len(sizes) - 1:
        bytes_value /= k
        i += 1
    return f"{bytes_value:.1f} {sizes[i]}"


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
    chunk_size: int = None,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> Dict[str, Any]:
    """
    Download a file from URL with progress tracking and speed calculation.
    
    Args:
        url: URL to download from
        dest_path: Destination file path
        download_id: Unique ID for tracking this download
        headers: Optional HTTP headers (for auth tokens)
        chunk_size: Download chunk size in bytes (defaults to 1MB)
        progress_callback: Optional callback(downloaded_bytes, total_bytes)
        
    Returns:
        Result dictionary with status and info
    """
    global download_progress, cancelled_downloads
    
    # Use default 1MB chunk size if not specified
    if chunk_size is None:
        chunk_size = CHUNK_SIZE
    
    result = {
        'success': False,
        'download_id': download_id,
        'path': dest_path,
        'error': None,
        'size': 0
    }
    
    # Initialize progress tracking with speed calculation
    start_time = time.time()
    speed_history: deque = deque(maxlen=SPEED_HISTORY_SIZE)
    last_speed_update = start_time
    last_downloaded = 0
    last_cli_log = start_time  # Track when we last logged to CLI
    
    with download_lock:
        download_progress[download_id] = {
            'status': 'starting',
            'progress': 0,
            'total_size': 0,
            'downloaded': 0,
            'filename': os.path.basename(dest_path),
            'url': url,
            'error': None,
            'speed': 0,  # bytes per second
            'start_time': start_time
        }
    
    try:
        # Ensure destination directory exists
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        
        # Verbose logging - what model and from where
        filename = os.path.basename(dest_path)
        source = "HuggingFace" if "huggingface.co" in url else "CivitAI" if "civitai.com" in url else "URL"
        print(f"\n[Model Linker] Starting download: {filename}")
        print(f"[Model Linker] Source: {source}")
        print(f"[Model Linker] URL: {url}")
        
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
        total_size_str = format_bytes(total_size) if total_size > 0 else "unknown"
        print(f"[Model Linker] Size: {total_size_str}")
        
        with download_lock:
            download_progress[download_id]['total_size'] = total_size
            download_progress[download_id]['status'] = 'downloading'
        
        downloaded = 0
        
        # Download with progress and speed calculation
        cancelled = False
        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                # Check for cancellation
                if download_id in cancelled_downloads:
                    cancelled = True
                    break
                
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    
                    # Calculate speed with smoothing
                    current_time = time.time()
                    time_delta = current_time - last_speed_update
                    
                    # Update speed every 0.5 seconds to avoid too frequent calculations
                    if time_delta >= 0.5:
                        bytes_delta = downloaded - last_downloaded
                        instant_speed = bytes_delta / time_delta if time_delta > 0 else 0
                        speed_history.append(instant_speed)
                        
                        # Calculate smoothed speed (average of recent samples)
                        smoothed_speed = sum(speed_history) / len(speed_history) if speed_history else 0
                        
                        last_speed_update = current_time
                        last_downloaded = downloaded
                        
                        # Update progress with speed
                        with download_lock:
                            download_progress[download_id]['downloaded'] = downloaded
                            download_progress[download_id]['speed'] = int(smoothed_speed)
                            if total_size > 0:
                                download_progress[download_id]['progress'] = int((downloaded / total_size) * 100)
                        
                        # CLI progress logging (every CLI_LOG_INTERVAL seconds)
                        if current_time - last_cli_log >= CLI_LOG_INTERVAL:
                            last_cli_log = current_time
                            progress_pct = int((downloaded / total_size) * 100) if total_size > 0 else 0
                            downloaded_str = format_bytes(downloaded)
                            total_str = format_bytes(total_size) if total_size > 0 else "?"
                            speed_str = format_bytes(int(smoothed_speed)) + "/s"
                            print(f"[Model Linker] Progress: {downloaded_str} / {total_str} ({progress_pct}%) - {speed_str}")
                    else:
                        # Just update downloaded bytes without recalculating speed
                        with download_lock:
                            download_progress[download_id]['downloaded'] = downloaded
                            if total_size > 0:
                                download_progress[download_id]['progress'] = int((downloaded / total_size) * 100)
                    
                    if progress_callback:
                        progress_callback(downloaded, total_size)
        
        # Handle cancellation after file is closed (so we can delete it on Windows)
        # Also check if cancellation was requested while we were finishing up
        if cancelled or download_id in cancelled_downloads:
            with download_lock:
                download_progress[download_id]['status'] = 'cancelled'
            # Clean up partial/incomplete file
            try:
                if os.path.exists(dest_path):
                    os.remove(dest_path)
                    print(f"[Model Linker] Cancelled: {filename} - incomplete file deleted")
                else:
                    print(f"[Model Linker] Cancelled: {filename} - no file to delete")
            except Exception as e:
                print(f"[Model Linker] Warning: Could not delete incomplete file {dest_path}: {e}")
                # Try harder on Windows - sometimes the file handle takes a moment to release
                try:
                    time.sleep(0.5)  # time is already imported at module level
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                        print(f"[Model Linker] Cancelled: {filename} - incomplete file deleted (delayed)")
                except Exception:
                    pass
            result['error'] = 'Download cancelled'
            cancelled_downloads.discard(download_id)
            return result
        
        # Success
        with download_lock:
            download_progress[download_id]['status'] = 'completed'
            download_progress[download_id]['progress'] = 100
            download_progress[download_id]['speed'] = 0  # Reset speed on completion
        
        result['success'] = True
        result['size'] = downloaded
        
        # CLI completion log
        elapsed = time.time() - start_time
        avg_speed = downloaded / elapsed if elapsed > 0 else 0
        print(f"[Model Linker] ✓ Download complete: {filename}")
        print(f"[Model Linker] Size: {format_bytes(downloaded)}, Time: {elapsed:.1f}s, Avg speed: {format_bytes(int(avg_speed))}/s")
        
    except requests.exceptions.RequestException as e:
        error_msg = str(e)
        # Check for specific HTTP errors
        if hasattr(e, 'response') and e.response is not None:
            status_code = e.response.status_code
            if status_code in [401, 403]:
                if 'huggingface.co' in url:
                    error_msg = f"Unauthorized (HTTP {status_code}): HuggingFace token may be required."
                elif 'civitai.com' in url:
                    error_msg = f"Unauthorized (HTTP {status_code}): CivitAI API key may be required."
                else:
                    error_msg = f"Unauthorized (HTTP {status_code}): Authentication required."
            elif status_code == 404:
                error_msg = "Model not found (HTTP 404): The file may have been moved or deleted."
        
        with download_lock:
            download_progress[download_id]['status'] = 'error'
            download_progress[download_id]['error'] = error_msg
        result['error'] = error_msg
        
        # CLI error log
        print(f"[Model Linker] ✗ Download failed: {os.path.basename(dest_path)}")
        print(f"[Model Linker] Error: {error_msg}")
        
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
        
        # CLI error log
        print(f"[Model Linker] ✗ Download failed: {os.path.basename(dest_path)}")
        print(f"[Model Linker] Error: {error_msg}")
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
