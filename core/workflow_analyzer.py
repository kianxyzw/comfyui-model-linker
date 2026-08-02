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
    'StyleModelLoader': 'style_models',
    'DiffusersLoader': 'diffusers',
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


# Cache of node_type -> list of derived categories (or None when nothing
# could be derived). Populated lazily; a failed introspection is cached too
# so misbehaving custom nodes are only probed once per session.
_NODE_MODEL_CATEGORIES_CACHE: Dict[str, Optional[List[str]]] = {}


def get_node_model_categories(node_type: str) -> Optional[List[str]]:
    """
    Derive the model folder categories a node type loads from by
    introspecting its INPUT_TYPES() combo option lists.

    Custom loader nodes (Nunchaku, Hy3D, IPAdapter, ...) populate their file
    combos from folder_paths.get_filename_list() at INPUT_TYPES() time, so
    matching an input's option list back to a category's file list tells us
    both that the input is a model field and which folder it loads from —
    without hardcoding every node type (issue #5).

    Returns:
        List of category names, or None if nothing could be derived.
    """
    if node_type in _NODE_MODEL_CATEGORIES_CACHE:
        return _NODE_MODEL_CATEGORIES_CACHE[node_type]

    categories = None
    try:
        import nodes as comfy_nodes
        node_class = comfy_nodes.NODE_CLASS_MAPPINGS.get(node_type)
        if node_class is not None:
            categories = _derive_categories_from_input_types(node_class)
    except Exception as e:
        logging.debug(f"Model Linker: could not introspect {node_type}: {e}")

    _NODE_MODEL_CATEGORIES_CACHE[node_type] = categories
    return categories


def _derive_categories_from_input_types(node_class) -> Optional[List[str]]:
    """Inspect a node class's INPUT_TYPES for combos of model filenames."""
    input_types = node_class.INPUT_TYPES()
    categories = []

    for section in ('required', 'optional'):
        inputs = input_types.get(section) or {}
        for _name, spec in inputs.items():
            options = spec[0] if isinstance(spec, (list, tuple)) and spec else None
            if not isinstance(options, (list, tuple)) or not options:
                continue
            if not all(isinstance(opt, str) for opt in options):
                continue
            # A combo whose options are model filenames is a model field
            if not any(is_model_filename(opt) for opt in options):
                continue

            category = _find_category_for_options(options)
            if category and category not in categories:
                categories.append(category)

    return categories or None


def _find_category_for_options(options) -> Optional[str]:
    """Find the folder category whose file list contains all the options."""
    if folder_paths is None:
        return None

    option_set = set(options)
    best = None
    for category in folder_paths.folder_names_and_paths.keys():
        if category in ('custom_nodes', 'configs'):
            continue
        try:
            files = set(folder_paths.get_filename_list(category))
        except Exception:
            continue
        if option_set <= files:
            # Prefer the tightest-fitting category when several qualify
            if best is None or len(files) < best[1]:
                best = (category, len(files))

    return best[0] if best else None


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

    # Workflows authored on another OS may use the opposite path separator;
    # folder_paths won't resolve those, so also try separator-swapped variants
    variants = [filename]
    if os.sep == '\\':
        swapped = filename.replace('/', '\\')
    else:
        swapped = filename.replace('\\', '/')
    if swapped != filename:
        variants.append(swapped)
    
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
        for variant in variants:
            try:
                full_path = folder_paths.get_full_path(category, variant)
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
    
    # Get category hints for this node type: hardcoded table first, then
    # INPUT_TYPES introspection for custom loader nodes (issue #5)
    category_hint = NODE_TYPE_TO_CATEGORY_HINTS.get(node_type)
    if category_hint:
        expected_categories = [category_hint]
    else:
        expected_categories = get_node_model_categories(node_type)
    categories_to_try = expected_categories  # None -> try all categories

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
            category = (expected_categories[0] if expected_categories else None) or 'unknown'
            full_path = None
            exists = False

        model_refs.append({
            'node_id': node_id,
            'node_type': node_type,
            'widget_index': idx,
            'original_path': value,
            'category': category,
            'expected_categories': expected_categories,
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


def group_models_by_file(
    workflow_models: List[Dict[str, Any]],
    exists_filter: Optional[bool] = None
) -> List[Dict[str, Any]]:
    """
    Group model references by file so each model appears once even when
    referenced by multiple nodes.

    Args:
        workflow_models: List of model references from analyze_workflow_models
        exists_filter: False -> only missing refs, True -> only resolved refs,
                       None -> all refs

    Returns:
        List of grouped model references (deduplicated by original_path).
        Each entry has 'all_node_refs' containing all node references for that model.
    """
    grouped: Dict[str, Dict[str, Any]] = {}

    for model_ref in workflow_models:
        if exists_filter is not None and model_ref.get('exists', False) != exists_filter:
            continue

        filename = model_ref.get('original_path', '')

        if filename not in grouped:
            # First occurrence - use this as the primary entry
            grouped[filename] = {
                **model_ref,
                'all_node_refs': [model_ref.copy()]  # Track all nodes using this model
            }
        else:
            # Duplicate - just add to the node refs list
            grouped[filename]['all_node_refs'].append(model_ref.copy())

    return list(grouped.values())


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
    return group_models_by_file(workflow_models, exists_filter=False)

