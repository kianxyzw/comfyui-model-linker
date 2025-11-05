"""
@author: Model Linker Team
@title: ComfyUI Model Linker
@nickname: Model Linker
@version: 1.0.0
@description: Extension for relinking missing models in ComfyUI workflows using fuzzy matching
"""

import logging
import json

# Web directory for JavaScript interface
WEB_DIRECTORY = "./web"

# Empty NODE_CLASS_MAPPINGS - we don't provide custom nodes, only web extension
# This prevents ComfyUI from showing "IMPORT FAILED" message
NODE_CLASS_MAPPINGS = {}

__all__ = ["WEB_DIRECTORY"]


class ModelLinkerExtension:
    """Main extension class for Model Linker."""
    
    def __init__(self):
        self.routes_setup = False
        self.logger = logging.getLogger(__name__)
    
    def initialize(self):
        """Initialize the extension and set up API routes."""
        try:
            self.setup_routes()
            self.logger.info("Model Linker: Extension initialized successfully")
        except Exception as e:
            self.logger.error(f"Model Linker: Extension initialization failed: {e}", exc_info=True)
    
    def setup_routes(self):
        """Register API routes for the Model Linker extension."""
        if self.routes_setup:
            return  # Already set up
        
        try:
            from aiohttp import web
            
            # Try to get routes from PromptServer
            try:
                from server import PromptServer
                if not hasattr(PromptServer, 'instance') or PromptServer.instance is None:
                    self.logger.debug("Model Linker: PromptServer not available yet")
                    return False
                
                routes = PromptServer.instance.routes
            except (ImportError, AttributeError) as e:
                self.logger.debug(f"Model Linker: Could not access PromptServer: {e}")
                return False
            
            # Import linker modules - use relative imports which should work for packages
            try:
                from .core.linker import analyze_and_find_matches, apply_resolution
                from .core.scanner import get_model_files
                from .core.overrides import record_override, load_overrides, get_overrides_path
            except ImportError as e:
                self.logger.error(f"Model Linker: Could not import core modules: {e}")
                return False
            
            @routes.post("/model_linker/analyze")
            async def analyze_workflow(request):
                """Analyze workflow and return missing models with matches."""
                try:
                    data = await request.json()
                    workflow_json = data.get('workflow')
                    
                    if not workflow_json:
                        return web.json_response(
                            {'error': 'Workflow JSON is required'},
                            status=400
                        )
                    
                    # Analyze and find matches
                    result = analyze_and_find_matches(workflow_json)
                    
                    return web.json_response(result)
                except Exception as e:
                    self.logger.error(f"Model Linker analyze error: {e}", exc_info=True)
                    return web.json_response(
                        {'error': str(e)},
                        status=500
                    )
            
            @routes.post("/model_linker/resolve")
            async def resolve_models(request):
                """Apply model resolution and return updated workflow."""
                try:
                    data = await request.json()
                    workflow_json = data.get('workflow')
                    resolutions = data.get('resolutions', [])
                    
                    if not workflow_json:
                        return web.json_response(
                            {'error': 'Workflow JSON is required'},
                            status=400
                        )
                    
                    if not resolutions:
                        return web.json_response(
                            {'error': 'Resolutions array is required'},
                            status=400
                        )
                    
                    # Make a deep copy of workflow to recover original widget values if needed
                    try:
                        workflow_before = json.loads(json.dumps(workflow_json))
                    except Exception:
                        workflow_before = None

                    # Apply resolutions
                    updated_workflow = apply_resolution(workflow_json, resolutions)

                    # Persist user choices as overrides (so next time we know the correct match)
                    try:
                        # helper to fetch the pre-update widget value
                        def _get_original_value(wf, node_id, widget_index, subgraph_id=None, is_top_level=None):
                            try:
                                if not wf:
                                    return None
                                # Decide where to look for node
                                if is_top_level is False or (is_top_level is None and subgraph_id):
                                    # Search subgraph definitions
                                    defs = (wf.get('definitions') or {}).get('subgraphs') or []
                                    for sg in defs:
                                        if sg.get('id') == subgraph_id:
                                            for n in sg.get('nodes') or []:
                                                if n.get('id') == node_id:
                                                    w = n.get('widgets_values') or []
                                                    return w[widget_index] if 0 <= widget_index < len(w) else None
                                # Fallback/top-level
                                for n in wf.get('nodes') or []:
                                    if n.get('id') == node_id:
                                        w = n.get('widgets_values') or []
                                        return w[widget_index] if 0 <= widget_index < len(w) else None
                            except Exception:
                                return None
                            return None

                        for res in resolutions:
                            # Expect original_path from client; otherwise derive from pre-update workflow
                            original_path = res.get('original_path')
                            if not original_path:
                                original_path = _get_original_value(
                                    workflow_before,
                                    res.get('node_id'),
                                    res.get('widget_index', 0),
                                    res.get('subgraph_id'),
                                    res.get('is_top_level')
                                )
                            category = res.get('category')
                            resolved_model = res.get('resolved_model')
                            resolved_path = res.get('resolved_path')
                            if original_path and (resolved_model or resolved_path):
                                record_override(original_path, category, resolved_model, resolved_path)
                    except Exception as e:
                        # Do not fail the request if persisting overrides fails
                        self.logger.warning(f"Model Linker: Failed to record overrides: {e}")
                    
                    return web.json_response({
                        'workflow': updated_workflow,
                        'success': True
                    })
                except Exception as e:
                    self.logger.error(f"Model Linker resolve error: {e}", exc_info=True)
                    return web.json_response(
                        {'error': str(e), 'success': False},
                        status=500
                    )
            
            @routes.get("/model_linker/models")
            async def get_models(request):
                """Get list of all available models (for debugging/UI display)."""
                try:
                    models = get_model_files()
                    return web.json_response(models)
                except Exception as e:
                    self.logger.error(f"Model Linker get_models error: {e}", exc_info=True)
                    return web.json_response(
                        {'error': str(e)},
                        status=500
                    )

            @routes.get("/model_linker/overrides")
            async def get_overrides(request):
                """Return current overrides and the file path used for persistence."""
                try:
                    doc = load_overrides()
                    path = get_overrides_path()
                    exists = False
                    try:
                        import os
                        exists = os.path.exists(path)
                    except Exception:
                        pass
                    return web.json_response({
                        'path': path,
                        'exists': exists,
                        'overrides': doc,
                    })
                except Exception as e:
                    self.logger.error(f"Model Linker get_overrides error: {e}", exc_info=True)
                    return web.json_response({'error': str(e)}, status=500)
            
            self.routes_setup = True
            self.logger.info("Model Linker: API routes registered successfully")
            return True
            
        except ImportError as e:
            self.logger.warning(f"Model Linker: Could not register routes (missing dependency): {e}")
            return False
        except Exception as e:
            self.logger.error(f"Model Linker: Error setting up routes: {e}", exc_info=True)
            return False


# Initialize the extension
try:
    extension = ModelLinkerExtension()
    extension.initialize()
except Exception as e:
    logging.error(f"ComfyUI Model Linker extension initialization failed: {e}", exc_info=True)
