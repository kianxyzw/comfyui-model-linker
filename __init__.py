"""
@author: Model Linker Team
@title: ComfyUI Model Linker
@nickname: Model Linker
@version: 1.1.0
@description: Extension for relinking missing models and downloading from HuggingFace/CivitAI
"""

import logging

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
            
            # Import linker modules
            try:
                from .core.linker import analyze_and_find_matches, apply_resolution
                from .core.scanner import get_model_files
            except ImportError as e:
                self.logger.error(f"Model Linker: Could not import core modules: {e}")
                return False
            
            # Import download modules
            try:
                from .core.downloader import (
                    start_background_download, get_progress, get_all_progress,
                    cancel_download, get_download_directory
                )
                from .core.sources.popular import get_popular_model_url, search_popular_models
                from .core.sources.model_list import search_model_list, search_model_list_multiple
                from .core.sources.huggingface import search_huggingface_for_file
                from .core.sources.civitai import search_civitai_for_file
                download_available = True
            except ImportError as e:
                self.logger.warning(f"Model Linker: Download features not available: {e}")
                download_available = False
            
            # ==================== ANALYZE ROUTES ====================
            
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
                    
                    # If download available, auto-search for download sources when no 100% local match
                    if download_available:
                        for missing in result.get('missing_models', []):
                            # Check if there's a 100% local match
                            matches = missing.get('matches', [])
                            has_perfect_match = any(m.get('confidence', 0) == 100 for m in matches)
                            
                            if not has_perfect_match:
                                filename = missing.get('original_path', '').split('/')[-1].split('\\')[-1]
                                
                                # 0. Check workflow URL first (highest priority - directly from workflow)
                                workflow_url = missing.get('workflow_url', '')
                                if workflow_url:
                                    # Determine source from URL
                                    if 'huggingface.co' in workflow_url:
                                        source = 'huggingface'
                                    elif 'civitai.com' in workflow_url:
                                        source = 'civitai'
                                    else:
                                        source = 'workflow'
                                    
                                    # Try to get file size with HEAD request (non-blocking, timeout quickly)
                                    file_size = None
                                    try:
                                        import requests
                                        head_response = requests.head(workflow_url, allow_redirects=True, timeout=5)
                                        if head_response.status_code == 200:
                                            file_size = int(head_response.headers.get('content-length', 0))
                                    except Exception:
                                        pass  # Size unknown is fine
                                    
                                    missing['download_source'] = {
                                        'source': source,
                                        'url': workflow_url,
                                        'filename': filename,
                                        'directory': missing.get('workflow_directory', '') or missing.get('category', 'checkpoints'),
                                        'match_type': 'exact',
                                        'url_source': 'workflow',
                                        'size': file_size
                                    }
                                    continue
                                
                                # 1. Check popular models (always exact match)
                                popular_info = get_popular_model_url(filename)
                                if popular_info:
                                    missing['download_source'] = {
                                        'source': 'popular',
                                        'url': popular_info.get('url'),
                                        'filename': filename,
                                        'type': popular_info.get('type'),
                                        'directory': popular_info.get('directory'),
                                        'match_type': 'exact'
                                    }
                                    continue
                                
                                # 2. Check model list (ComfyUI Manager database)
                                # Use exact_only=True to avoid confusing fuzzy matches for downloads
                                model_list_result = search_model_list(filename, exact_only=True)
                                if model_list_result:
                                    missing['download_source'] = {
                                        'source': 'model_list',
                                        'url': model_list_result.get('url'),
                                        'filename': model_list_result.get('filename'),
                                        'name': model_list_result.get('name'),
                                        'type': model_list_result.get('type'),
                                        'directory': model_list_result.get('directory'),
                                        'size': model_list_result.get('size'),
                                        'match_type': model_list_result.get('match_type'),
                                        'confidence': model_list_result.get('confidence')
                                    }
                                    continue
                                
                                # 3. Search HuggingFace (exact_only=True for downloads)
                                hf_result = search_huggingface_for_file(filename, exact_only=True)
                                if hf_result:
                                    missing['download_source'] = {
                                        'source': 'huggingface',
                                        'url': hf_result.get('url'),
                                        'filename': hf_result.get('filename'),
                                        'name': hf_result.get('repo_id', ''),
                                        'size': hf_result.get('size', ''),
                                        'match_type': hf_result.get('match_type', 'exact')
                                    }
                                    continue
                                
                                # 4. Search CivitAI (exact_only=True for downloads)
                                civitai_result = search_civitai_for_file(filename, exact_only=True)
                                if civitai_result:
                                    missing['download_source'] = {
                                        'source': 'civitai',
                                        'url': civitai_result.get('download_url'),  # CivitAI uses download_url
                                        'filename': civitai_result.get('filename'),
                                        'name': civitai_result.get('name', ''),
                                        'size': civitai_result.get('size', ''),
                                        'match_type': civitai_result.get('match_type', 'exact')
                                    }
                    
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
                    
                    # Apply resolutions
                    updated_workflow = apply_resolution(workflow_json, resolutions)
                    
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
                """Get list of all available models."""
                try:
                    models = get_model_files()
                    return web.json_response(models)
                except Exception as e:
                    self.logger.error(f"Model Linker get_models error: {e}", exc_info=True)
                    return web.json_response(
                        {'error': str(e)},
                        status=500
                    )
            
            # ==================== DOWNLOAD ROUTES ====================
            
            if download_available:
                
                @routes.post("/model_linker/search")
                async def search_sources(request):
                    """Search for model download sources."""
                    try:
                        data = await request.json()
                        filename = data.get('filename', '')
                        category = data.get('category', '')
                        
                        if not filename:
                            return web.json_response(
                                {'error': 'Filename is required'},
                                status=400
                            )
                        
                        results = {
                            'popular': None,
                            'model_list': None,
                            'huggingface': None,
                            'civitai': None,
                            'found': False
                        }
                        
                        # 1. Check popular models first (curated database)
                        popular_info = get_popular_model_url(filename)
                        if popular_info:
                            results['popular'] = {
                                'source': 'popular',
                                'filename': filename,
                                **popular_info
                            }
                            results['found'] = True
                        
                        # 2. Search model-list.json (ComfyUI Manager database with fuzzy matching)
                        if not results['found']:
                            model_list_result = search_model_list(filename)
                            if model_list_result:
                                results['model_list'] = model_list_result
                                results['found'] = True
                        
                        # 3. Search HuggingFace for exact file match
                        if not results['found']:
                            hf_result = search_huggingface_for_file(filename)
                            if hf_result:
                                results['huggingface'] = hf_result
                                results['found'] = True
                        
                        # 4. Search CivitAI for exact file match
                        if not results['found']:
                            civitai_result = search_civitai_for_file(filename)
                            if civitai_result:
                                results['civitai'] = civitai_result
                                results['found'] = True
                        
                        return web.json_response(results)
                        
                    except Exception as e:
                        self.logger.error(f"Model Linker search error: {e}", exc_info=True)
                        return web.json_response(
                            {'error': str(e)},
                            status=500
                        )
                
                @routes.post("/model_linker/download")
                async def download_model(request):
                    """Start downloading a model."""
                    try:
                        data = await request.json()
                        url = data.get('url', '')
                        filename = data.get('filename', '')
                        category = data.get('category', 'checkpoints')
                        subfolder = data.get('subfolder', '')
                        
                        if not url:
                            return web.json_response(
                                {'error': 'URL is required'},
                                status=400
                            )
                        
                        if not filename:
                            # Extract filename from URL
                            from urllib.parse import urlparse, unquote
                            parsed = urlparse(url)
                            filename = unquote(parsed.path.split('/')[-1])
                        
                        if not filename:
                            return web.json_response(
                                {'error': 'Could not determine filename'},
                                status=400
                            )
                        
                        # Build headers if needed
                        headers = {}
                        if 'huggingface.co' in url:
                            hf_token = data.get('hf_token', '')
                            if hf_token:
                                headers['Authorization'] = f'Bearer {hf_token}'
                        elif 'civitai.com' in url:
                            civitai_key = data.get('civitai_key', '')
                            if civitai_key and 'token=' not in url:
                                url += f"{'&' if '?' in url else '?'}token={civitai_key}"
                        
                        # Start background download
                        download_id = start_background_download(
                            url=url,
                            filename=filename,
                            category=category,
                            headers=headers if headers else None,
                            subfolder=subfolder
                        )
                        
                        return web.json_response({
                            'success': True,
                            'download_id': download_id,
                            'filename': filename,
                            'category': category
                        })
                        
                    except Exception as e:
                        self.logger.error(f"Model Linker download error: {e}", exc_info=True)
                        return web.json_response(
                            {'error': str(e), 'success': False},
                            status=500
                        )
                
                @routes.get("/model_linker/progress/{download_id}")
                async def get_download_progress(request):
                    """Get progress for a specific download."""
                    try:
                        download_id = request.match_info['download_id']
                        progress = get_progress(download_id)
                        
                        if progress:
                            return web.json_response(progress)
                        else:
                            return web.json_response(
                                {'error': 'Download not found'},
                                status=404
                            )
                    except Exception as e:
                        self.logger.error(f"Model Linker progress error: {e}", exc_info=True)
                        return web.json_response(
                            {'error': str(e)},
                            status=500
                        )
                
                @routes.get("/model_linker/progress")
                async def get_all_downloads_progress(request):
                    """Get progress for all downloads."""
                    try:
                        progress = get_all_progress()
                        return web.json_response(progress)
                    except Exception as e:
                        self.logger.error(f"Model Linker progress error: {e}", exc_info=True)
                        return web.json_response(
                            {'error': str(e)},
                            status=500
                        )
                
                @routes.post("/model_linker/cancel/{download_id}")
                async def cancel_download_route(request):
                    """Cancel a download in progress."""
                    try:
                        download_id = request.match_info['download_id']
                        cancel_download(download_id)
                        return web.json_response({'success': True})
                    except Exception as e:
                        self.logger.error(f"Model Linker cancel error: {e}", exc_info=True)
                        return web.json_response(
                            {'error': str(e), 'success': False},
                            status=500
                        )
                
                @routes.get("/model_linker/directories")
                async def get_directories(request):
                    """Get available model directories."""
                    try:
                        categories = [
                            'checkpoints', 'loras', 'vae', 'controlnet', 
                            'clip', 'clip_vision', 'embeddings', 'upscale_models',
                            'diffusion_models', 'text_encoders', 'ipadapter', 'sams'
                        ]
                        
                        directories = {}
                        for cat in categories:
                            path = get_download_directory(cat)
                            if path:
                                directories[cat] = path
                        
                        return web.json_response(directories)
                    except Exception as e:
                        self.logger.error(f"Model Linker directories error: {e}", exc_info=True)
                        return web.json_response(
                            {'error': str(e)},
                            status=500
                        )
            
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
