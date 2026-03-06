"""
Core Linker Module

Integrates all components to provide high-level API for model linking.
"""

import os
import logging
from typing import Dict, Any, List, Optional

from .scanner import get_model_files
from .workflow_analyzer import analyze_workflow_models, identify_missing_models
from .matcher import find_matches
from .workflow_updater import update_workflow_nodes
from .overrides import find_override_model


def analyze_and_find_matches(
    workflow_json: Dict[str, Any],
    similarity_threshold: float = 0.0,
    max_matches_per_model: int = 10
) -> Dict[str, Any]:
    """
    Main entry point: analyze workflow and find matches for missing models.
    
    Args:
        workflow_json: Complete workflow JSON dictionary
        similarity_threshold: Minimum similarity score (0.0 to 1.0) for matches
        max_matches_per_model: Maximum number of matches to return per missing model
        
    Returns:
        Dictionary with analysis results:
        {
            'missing_models': [
                {
                    'node_id': node ID,
                    'node_type': node type,
                    'widget_index': widget index,
                    'original_path': original path from workflow,
                    'category': model category,
                    'matches': [
                        {
                            'model': model dict from scanner,
                            'filename': model filename,
                            'similarity': similarity score (0.0-1.0),
                            'confidence': confidence percentage (0-100)
                        },
                        ...
                    ]
                },
                ...
            ],
            'total_missing': count of missing models,
            'total_models_analyzed': count of all models in workflow
        }
    """
    # Analyze workflow to find all model references
    all_model_refs = analyze_workflow_models(workflow_json)
    
    # Get available models
    available_models = get_model_files()
    
    # Identify missing models
    missing_models = identify_missing_models(all_model_refs, available_models)
    
    # Find matches for each missing model
    missing_with_matches = []
    for missing in missing_models:
        original_path = missing.get('original_path', '')
        
        # Filter available models by category if known
        # IMPORTANT: If category is 'unknown', we still try to find the right category
        # by using node type hints
        category = missing.get('category')
        
        # If category is unknown, try to use node type to infer category
        if not category or category == 'unknown':
            from .workflow_analyzer import NODE_TYPE_TO_CATEGORY_HINTS
            node_type = missing.get('node_type', '')
            category = NODE_TYPE_TO_CATEGORY_HINTS.get(node_type, 'unknown')
        
        candidates = available_models
        if category and category != 'unknown':
            # Prioritize models from the same category
            candidates = [m for m in available_models if m.get('category') == category]
            # Also include other categories as fallback
            candidates.extend([m for m in available_models if m.get('category') != category])
        
        # First: compute fuzzy matches as usual
        matches = find_matches(
            original_path,
            candidates,
            threshold=similarity_threshold,
            max_results=max_matches_per_model
        )

        # Then: check if user has a saved override; inject it as a 99% match (not 100%)
        override_model = find_override_model(original_path, category, available_models)
        if override_model is not None:
            override_path = os.path.normpath(override_model.get('path', '') or '')
            # Check if already present in matches
            found = None
            for m in matches:
                p = os.path.normpath(m.get('model', {}).get('path', '') or '')
                if p and p == override_path:
                    found = m
                    break
            if found:
                # Boost to 100% and mark as override
                found['similarity'] = 1.0
                found['confidence'] = 100.0
                found['is_override'] = True
            else:
                matches.append({
                    'model': override_model,
                    'filename': override_model.get('filename'),
                    'similarity': 1.0,
                    'confidence': 100.0,
                    'is_override': True,
                })
        
        # Deduplicate matches by absolute path - same physical file should only appear once
        # This handles cases where the same file exists in multiple base directories
        # or has different relative_paths but is the same file
        seen_absolute_paths = {}
        deduplicated_matches = []
        for match in matches:
            model_dict = match['model']
            absolute_path = model_dict.get('path', '')
            
            # Normalize absolute path for comparison
            if absolute_path:
                absolute_path = os.path.normpath(absolute_path)
            
            # If we haven't seen this absolute path, add it
            if absolute_path not in seen_absolute_paths:
                seen_absolute_paths[absolute_path] = match
                deduplicated_matches.append(match)
            else:
                # If we've seen this absolute path before, replace with better match if confidence is higher
                existing_match = seen_absolute_paths[absolute_path]
                if match['confidence'] > existing_match['confidence']:
                    # Replace with better match
                    idx = deduplicated_matches.index(existing_match)
                    deduplicated_matches[idx] = match
                    seen_absolute_paths[absolute_path] = match
        
        missing_with_matches.append({
            **missing,
            'matches': deduplicated_matches
        })
    
    return {
        'missing_models': missing_with_matches,
        'total_missing': len(missing_with_matches),
        'total_models_analyzed': len(all_model_refs)
    }


def apply_resolution(
    workflow_json: Dict[str, Any],
    resolutions: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Apply model resolutions to workflow.
    
    Args:
        workflow_json: Workflow JSON dictionary (will be modified)
        resolutions: List of resolution dictionaries:
            {
                'node_id': node ID,
                'widget_index': widget index,
                'resolved_path': absolute path to resolved model,
                'category': model category (optional),
                'resolved_model': model dict from scanner (optional)
            }
            
    Returns:
        Updated workflow JSON dictionary
    """
    # Prepare mappings for workflow_updater
    mappings = []
    for resolution in resolutions:
        mapping = {
            'node_id': resolution.get('node_id'),
            'widget_index': resolution.get('widget_index'),
            'resolved_path': resolution.get('resolved_path'),
            'category': resolution.get('category'),
            'resolved_model': resolution.get('resolved_model'),
            'subgraph_id': resolution.get('subgraph_id'),  # Include subgraph_id for subgraph nodes
            'is_top_level': resolution.get('is_top_level'),  # True for top-level nodes, False for nodes in subgraph definitions
            'nested_key': resolution.get('nested_key'),  # For dict-type widgets (e.g. Power Lora Loader)
        }
        
        # If resolved_model provided, extract path if needed
        if 'resolved_model' in resolution and resolution['resolved_model']:
            resolved_model = resolution['resolved_model']
            if 'path' in resolved_model and not mapping.get('resolved_path'):
                mapping['resolved_path'] = resolved_model['path']
            if 'base_directory' in resolved_model:
                mapping['base_directory'] = resolved_model['base_directory']
        
        mappings.append(mapping)
    
    # Update workflow
    updated_workflow = update_workflow_nodes(workflow_json, mappings)
    
    return updated_workflow


def get_resolution_summary(workflow_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get summary of missing models and matches without applying resolutions.
    
    This is a convenience method that calls analyze_and_find_matches with defaults.
    
    Args:
        workflow_json: Complete workflow JSON dictionary
        
    Returns:
        Same format as analyze_and_find_matches
    """
    return analyze_and_find_matches(workflow_json)

