"""
Workflow Analyzer Module

Extracts model references from workflow JSON and identifies missing models.
"""

import os
import logging
from typing import List, Dict, Any, Optional

# Import folder_paths lazily - it may not be available until ComfyUI is initialized
try:
    import folder_paths
except ImportError:
    folder_paths = None
    logging.warning("Model Linker: folder_paths not available yet - will retry later")


# Common model file extensions
MODEL_EXTENSIONS = {'.ckpt', '.pt', '.pt2', '.bin', '.pth', '.safetensors', '.pkl', '.sft', '.onnx'}

# Node types that should never be scanned for model references.
# These are note/utility nodes whose widget values may contain model filenames
# as text content (e.g. markdown links) but are NOT actual model references.
SKIP_NODE_TYPES = {
    'MarkdownNote', 'Note', 'NoteNode', 'TextNote',
    'Reroute', 'PrimitiveNode',
}

# Mapping of common node types to their expected model category
# This is used as hints but we don't rely solely on this
# UNETLoader uses 'diffusion_models' category (folder_paths maps 'unet' to 'diffusion_models')
NODE_TYPE_TO_CATEGORY_HINTS = {
    'CheckpointLoaderSimple': 'checkpoints',
    'CheckpointLoader': 'checkpoints',
    'unCLIPCheckpointLoader': 'checkpoints',
    'VAELoader': 'vae',
    'LoraLoader': 'loras',
    'LoraLoaderModelOnly': 'loras',
    'UNETLoader': 'diffusion_models',  # UNETLoader uses diffusion_models category
    'ControlNetLoader': 'controlnet',
    'ControlNetLoaderAdvanced': 'controlnet',
    'CLIPLoader': 'text_encoders',
    'DualCLIPLoader': 'text_encoders',
    'TripleCLIPLoader': 'text_encoders',
    'CLIPVisionLoader': 'clip_vision',
    'UpscaleModelLoader': 'upscale_models',
    'LatentUpscaleModelLoader': 'latent_upscale_models',
    'StyleModelLoader': 'style_models',
    'HypernetworkLoader': 'hypernetworks',
    'EmbeddingLoader': 'embeddings',
}


def is_model_filename(value: Any) -> bool:
    """
    Check if a value looks like a model filename.
    
    Args:
        value: The value to check
        
    Returns:
        True if it looks like a model filename
    """
    if not isinstance(value, str):
        return False
    
    # Check if it ends with a model extension
    _, ext = os.path.splitext(value.lower())
    return ext in MODEL_EXTENSIONS


def try_resolve_model_path(value: str, categories: List[str] = None) -> Optional[tuple[str, str]]:
    """
    Try to resolve a model path using folder_paths.
    
    Args:
        value: The model filename/path to resolve
        categories: Optional list of categories to try (if None, tries all)
        
    Returns:
        Tuple of (category, full_path) if found, None otherwise
    """
    if not isinstance(value, str) or not value.strip():
        return None
    
    # Remove any path separators that might indicate an absolute path prefix
    # Workflows should store relative paths, but handle both cases
    filename = value.strip()
    
    # Ensure folder_paths is available
    global folder_paths
    if folder_paths is None:
        try:
            import folder_paths as fp
            folder_paths = fp
        except ImportError:
            logging.error("Model Linker: folder_paths not available")
            return None
    
    # If categories not provided, try all categories
    if categories is None:
        categories = list(folder_paths.folder_names_and_paths.keys())
    
    # Skip non-model categories
    skip_categories = {'custom_nodes', 'configs'}
    categories = [c for c in categories if c not in skip_categories]
    
    for category in categories:
        try:
            full_path = folder_paths.get_full_path(category, filename)
            if full_path and os.path.exists(full_path):
                return (category, full_path)
        except Exception:
            continue
    
    return None


def get_node_model_info(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract model references from a single node.

    This scans all widgets_values entries and tries to identify which ones
    are model file references by attempting to resolve them.

    Handles both array and dict formats for widgets_values (newer ComfyUI
    frontends may serialize widgets_values as an object with named keys).

    Uses properties.models (when available) for accurate category detection.

    Args:
        node: Node dictionary from workflow JSON

    Returns:
        List of model reference dictionaries:
        {
            'node_id': node id,
            'node_type': node type,
            'widget_index': index in widgets_values (int for array, str for dict),
            'original_path': original path from workflow,
            'category': model category (if found),
            'exists': True if model exists
        }
    """
    model_refs = []
    node_id = node.get('id')
    node_type = node.get('type', '')

    # Skip note/markdown/utility node types that don't contain model references
    if node_type in SKIP_NODE_TYPES:
        return model_refs

    widgets_values = node.get('widgets_values')
    if not widgets_values:
        return model_refs

    # Get category hints for this node type
    category_hint = NODE_TYPE_TO_CATEGORY_HINTS.get(node_type)

    # Build per-model category map from properties.models (newer ComfyUI feature)
    # This provides reliable category info for each model the node expects
    properties_models = (node.get('properties') or {}).get('models') or []
    model_category_map: Dict[str, str] = {}
    for pm in properties_models:
        name = pm.get('name', '')
        directory = pm.get('directory', '')
        if name and directory:
            model_category_map[name] = directory

    # Handle both array and dict format for widgets_values
    if isinstance(widgets_values, dict):
        items = list(widgets_values.items())  # [(key, value), ...]
    elif isinstance(widgets_values, (list, tuple)):
        items = list(enumerate(widgets_values))  # [(index, value), ...]
    else:
        return model_refs

    for idx, value in items:
        if not is_model_filename(value):
            continue

        # Determine best category: properties.models > node type hint > all categories
        value_category = model_category_map.get(value) or category_hint
        categories_to_try = [value_category] if value_category else None

        # Try to resolve the model path
        resolved = try_resolve_model_path(value, categories_to_try)

        if resolved:
            category, full_path = resolved
            exists = os.path.exists(full_path)
        else:
            # If we can't resolve it, check if it at least looks like a model filename
            # This might be a missing model or a custom node's model
            category = value_category or 'unknown'
            full_path = None
            exists = False

        model_refs.append({
            'node_id': node_id,
            'node_type': node_type,
            'widget_index': idx,
            'original_path': value,
            'category': category,
            'full_path': full_path,
            'exists': exists
        })

    return model_refs


def analyze_workflow_models(workflow_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract all model references from a workflow, including nested subgraphs.
    
    Args:
        workflow_json: Complete workflow JSON dictionary
        
    Returns:
        List of model reference dictionaries (same format as get_node_model_info)
        Each dict includes 'subgraph_id' if the model is in a subgraph
    """
    all_model_refs = []
    
    # Get subgraph definitions first to check if node types are subgraph UUIDs
    definitions = workflow_json.get('definitions', {})
    subgraphs = definitions.get('subgraphs', [])
    subgraph_lookup = {sg.get('id'): sg.get('name', sg.get('id')) for sg in subgraphs}
    
    # Analyze top-level nodes
    nodes = workflow_json.get('nodes', [])
    for node in nodes:
        try:
            model_refs = get_node_model_info(node)
            node_type = node.get('type', '')
            
            # Check if node type is a subgraph UUID
            subgraph_name = None
            subgraph_id = None
            if node_type in subgraph_lookup:
                subgraph_name = subgraph_lookup[node_type]
                subgraph_id = node_type
            
            # Mark with subgraph info if it's a subgraph node
            # For top-level subgraph instance nodes, subgraph_path is None
            # This distinguishes them from nodes within subgraph definitions
            for ref in model_refs:
                ref['subgraph_id'] = subgraph_id
                ref['subgraph_name'] = subgraph_name
                ref['subgraph_path'] = None  # Top-level, not in definitions.subgraphs
                ref['is_top_level'] = True  # Flag to indicate this is a top-level node
            all_model_refs.extend(model_refs)
        except Exception as e:
            logging.warning(f"Error analyzing node {node.get('id', 'unknown')}: {e}")
            continue
    
    # Recursively analyze subgraphs (definitions already loaded above)
    if not subgraphs:  # Re-get if not loaded above
        subgraphs = definitions.get('subgraphs', [])
    
    for subgraph in subgraphs:
        subgraph_id = subgraph.get('id')
        subgraph_name = subgraph.get('name', subgraph_id)
        subgraph_nodes = subgraph.get('nodes', [])
        
        logging.debug(f"Analyzing subgraph: {subgraph_name} (ID: {subgraph_id}) with {len(subgraph_nodes)} nodes")
        
        for node in subgraph_nodes:
            try:
                model_refs = get_node_model_info(node)
                # Mark as belonging to this subgraph definition
                for ref in model_refs:
                    ref['subgraph_id'] = subgraph_id
                    ref['subgraph_name'] = subgraph_name
                    ref['subgraph_path'] = ['definitions', 'subgraphs', subgraph_id, 'nodes']
                    ref['is_top_level'] = False  # This is inside a subgraph definition
                all_model_refs.extend(model_refs)
            except Exception as e:
                logging.warning(f"Error analyzing subgraph node {node.get('id', 'unknown')}: {e}")
                continue
    
    return all_model_refs


def identify_missing_models(
    workflow_models: List[Dict[str, Any]],
    available_models: List[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    Identify which models from the workflow are missing.
    
    Args:
        workflow_models: List of model references from analyze_workflow_models
        available_models: Optional list of available models (if None, checks via folder_paths)
        
    Returns:
        List of missing model references (filtered to only missing ones)
    """
    missing = []
    
    for model_ref in workflow_models:
        # If exists is False, it's missing
        if not model_ref.get('exists', False):
            missing.append(model_ref)
    
    return missing

