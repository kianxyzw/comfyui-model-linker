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
    'CLIPVisionLoader': 'clip_vision',
    'UpscaleModelLoader': 'upscale_models',
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
    
    Args:
        node: Node dictionary from workflow JSON
        
    Returns:
        List of model reference dictionaries:
        {
            'node_id': node id,
            'node_type': node type,
            'widget_index': index in widgets_values,
            'original_path': original path from workflow,
            'category': model category (if found),
            'exists': True if model exists
        }
    """
    model_refs = []
    node_id = node.get('id')
    node_type = node.get('type', '')
    widgets_values = node.get('widgets_values', [])
    
    if not widgets_values:
        return model_refs
    
    # Get category hints for this node type
    category_hint = NODE_TYPE_TO_CATEGORY_HINTS.get(node_type)
    categories_to_try = [category_hint] if category_hint else None
    
    # For each widget value, check if it looks like a model file
    for idx, value in enumerate(widgets_values):
        if not is_model_filename(value):
            continue
        
        # Try to resolve the model path
        resolved = try_resolve_model_path(value, categories_to_try)
        
        if resolved:
            category, full_path = resolved
            exists = os.path.exists(full_path)
        else:
            # If we can't resolve it, check if it at least looks like a model filename
            # This might be a missing model or a custom node's model
            category = category_hint or 'unknown'
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
    Deduplicates by filename - same model file only appears once even if
    referenced by multiple nodes.
    
    Args:
        workflow_models: List of model references from analyze_workflow_models
        available_models: Optional list of available models (if None, checks via folder_paths)
        
    Returns:
        List of missing model references (deduplicated by filename).
        Each entry has 'all_node_refs' containing all node references for that model.
    """
    # Group missing models by filename to deduplicate
    missing_by_filename: Dict[str, Dict[str, Any]] = {}
    
    for model_ref in workflow_models:
        # If exists is False, it's missing
        if not model_ref.get('exists', False):
            filename = model_ref.get('original_path', '')
            
            if filename not in missing_by_filename:
                # First occurrence - use this as the primary entry
                missing_by_filename[filename] = {
                    **model_ref,
                    'all_node_refs': [model_ref.copy()]  # Track all nodes needing this model
                }
            else:
                # Duplicate - just add to the node refs list
                missing_by_filename[filename]['all_node_refs'].append(model_ref.copy())
    
    # Return deduplicated list
    return list(missing_by_filename.values())

