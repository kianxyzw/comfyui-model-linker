"""
Directory Scanner Module

Scans configured model directories and finds available model files.
"""

import os
import logging
from typing import List, Dict, Tuple

# Import folder_paths lazily - it may not be available until ComfyUI is initialized
try:
    import folder_paths
except ImportError:
    folder_paths = None
    logging.warning("Model Linker: folder_paths not available yet - will retry later")

# Model file extensions to look for
# This matches folder_paths.supported_pt_extensions
MODEL_EXTENSIONS = {'.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft', '.onnx'}


def get_model_directories() -> Dict[str, Tuple[List[str], set]]:
    """
    Get all configured model directories from folder_paths.
    
    Returns:
        Dictionary mapping category name to a tuple. ComfyUI may provide either:
        - (paths, extensions), or
        - (paths, extensions, recursive_flag)
    """
    global folder_paths
    
    if folder_paths is None:
        # Try to import again
        try:
            import folder_paths as fp
            folder_paths = fp
        except ImportError:
            logging.error("Model Linker: folder_paths still not available")
            return {}
    
    return folder_paths.folder_names_and_paths.copy()


def scan_directory(directory: str, extensions: set, category: str) -> List[Dict[str, str]]:
    """
    Recursively scan a single directory for model files.
    
    Args:
        directory: Absolute path to directory to scan
        extensions: Set of file extensions to look for
        category: Model category name (e.g., 'checkpoints', 'loras')
        
    Returns:
        List of dictionaries with model information:
        {
            'filename': 'model.safetensors',
            'path': 'absolute/path/to/model.safetensors',
            'relative_path': 'subfolder/model.safetensors' or 'model.safetensors',
            'category': 'checkpoints',
            'base_directory': 'absolute/path/to/base'
        }
    """
    models = []
    
    if not os.path.exists(directory) or not os.path.isdir(directory):
        logging.debug(f"Directory does not exist or is not accessible: {directory}")
        return models
    
    try:
        # Get absolute path and normalize
        base_directory = os.path.abspath(directory)
        
        # Walk through directory recursively
        for root, dirs, files in os.walk(base_directory, followlinks=True):
            # Skip hidden directories
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            
            for filename in files:
                # Check if file has a model extension
                file_ext = os.path.splitext(filename)[1].lower()
                
                # For categories with empty extension set, accept all files
                # Otherwise, check if extension matches
                # Accept if:
                # - no explicit extensions configured, or
                # - matches configured extensions, or
                # - matches our known model extensions
                if len(extensions or set()) == 0 or file_ext in extensions or file_ext in MODEL_EXTENSIONS:
                    full_path = os.path.join(root, filename)
                    
                    # Calculate relative path from base directory
                    # IMPORTANT: Use OS-native path separators (backslashes on Windows)
                    # This matches ComfyUI's recursive_search format for get_filename_list
                    try:
                        relative_path = os.path.relpath(full_path, base_directory)
                        # DO NOT normalize - keep OS-native separators to match ComfyUI
                        # ComfyUI's get_filename_list uses os.path.relpath which returns
                        # backslashes on Windows, forward slashes on Unix
                    except ValueError:
                        # If paths are on different drives (Windows), use filename only
                        relative_path = filename
                    
                    models.append({
                        'filename': filename,
                        'path': full_path,
                        'relative_path': relative_path,
                        'category': category,
                        'base_directory': base_directory
                    })
    except (OSError, PermissionError) as e:
        logging.warning(f"Error scanning directory {directory}: {e}")
    
    return models


def scan_all_directories() -> List[Dict[str, str]]:
    """
    Scan all configured model directories and return list of available models.
    
    Returns:
        List of dictionaries with model information (same format as scan_directory)
    """
    all_models = []
    directories = get_model_directories()
    
    for category, value in directories.items():
        # Skip categories that aren't typically model directories
        if category in ['custom_nodes', 'configs']:
            continue

        # Unpack folder_paths value flexibly: (paths, extensions) or (paths, extensions, recursive)
        paths = []
        extensions = set()
        try:
            if isinstance(value, (list, tuple)):
                if len(value) >= 2:
                    paths = value[0] or []
                    raw_exts = value[1]
                else:
                    # Unexpected format: treat value as paths
                    paths = list(value)
                    raw_exts = []
            elif isinstance(value, dict):
                paths = value.get('paths') or value.get('path') or []
                raw_exts = value.get('extensions') or []
            else:
                # Unknown format; skip category
                logging.debug(f"Unexpected folder_paths format for category {category}: {type(value)}")
                continue

            # Normalize extensions to a set[str]
            if isinstance(raw_exts, (list, tuple, set)):
                extensions = {str(e).lower() for e in raw_exts}
            elif raw_exts:
                extensions = {str(raw_exts).lower()}
        except Exception as e:
            logging.warning(f"Error interpreting folder_paths entry for {category}: {e}")
            continue

        for directory_path in paths:
            try:
                models = scan_directory(directory_path, extensions, category)
                all_models.extend(models)
                logging.debug(f"Found {len(models)} models in {category}/{directory_path}")
            except Exception as e:
                logging.warning(f"Error scanning {category} directory {directory_path}: {e}")
    
    return all_models


def get_model_files() -> List[Dict[str, str]]:
    """
    Get list of all available model files with metadata.
    
    This is the main entry point for getting model files.
    
    Returns:
        List of model dictionaries (same format as scan_directory)
    """
    return scan_all_directories()

