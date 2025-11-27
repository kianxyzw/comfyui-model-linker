/**
 * ComfyUI Model Linker Extension - Frontend
 * 
 * Provides a menu button and dialog interface for relinking missing models in workflows.
 */

// Import ComfyUI APIs
// These paths are relative to the ComfyUI web directory
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { $el, ComfyDialog } from "../../../scripts/ui.js";

// Check if ComfyButtonGroup is available (from newer ComfyUI versions)
let ComfyButtonGroup = null;
try {
    // Try to import from scripts if available
    if (typeof window !== 'undefined') {
        try {
            // Some ComfyUI versions expose this globally
            if (window.ComfyButtonGroup) {
                ComfyButtonGroup = window.ComfyButtonGroup;
            }
        } catch (e) {
            // Ignore
        }
    }
} catch (e) {
    // Fallback if ComfyButtonGroup not available
}

class LinkerManagerDialog extends ComfyDialog {
    constructor() {
        super();
        this.currentWorkflow = null;
        this.missingModels = [];
        
        // Create dialog element using $el
        this.element = $el("div.comfy-modal", {
            parent: document.body,
            style: {
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "900px",
                height: "700px",
                maxWidth: "95vw",
                maxHeight: "95vh",
                backgroundColor: "var(--comfy-menu-bg, #202020)",
                color: "var(--input-text, #ffffff)",
                border: "2px solid var(--border-color, #555555)",
                borderRadius: "8px",
                padding: "0",
                zIndex: "99999",
                boxShadow: "0 4px 20px rgba(0,0,0,0.8)",
                display: "none",
                flexDirection: "column"
            }
        }, [
            this.createHeader(),
            this.createContent(),
            this.createFooter()
        ]);
    }
    
    createHeader() {
        return $el("div", {
            style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 20px 10px 20px",
                borderBottom: "1px solid var(--border-color)",
                backgroundColor: "var(--comfy-menu-bg, #202020)"
            }
        }, [
            $el("h2", {
                textContent: "🔗 Model Linker",
                style: {
                    margin: "0",
                    color: "var(--input-text)",
                    fontSize: "18px",
                    fontWeight: "600"
                }
            }),
            $el("button", {
                textContent: "×",
                onclick: () => this.close(),
                style: {
                    background: "none",
                    border: "none",
                    fontSize: "24px",
                    cursor: "pointer",
                    color: "var(--input-text)",
                    padding: "0",
                    width: "30px",
                    height: "30px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }
            })
        ]);
    }
    
    createContent() {
        this.contentElement = $el("div", {
            id: "model-linker-content",
            style: {
                padding: "16px",
                overflowY: "auto",
                flex: "1",
                minHeight: "0"
            }
        });
        return this.contentElement;
    }
    
    createFooter() {
        return $el("div", {
            style: {
                padding: "16px",
                borderTop: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px"
            }
        }, [
            $el("button", {
                textContent: "Auto-Resolve 100% Matches",
                onclick: () => this.autoResolve100Percent(),
                className: "comfy-button",
                style: {
                    padding: "8px 16px"
                }
            })
        ]);
    }
    
    async show() {
        this.element.style.display = "flex";
        await this.loadWorkflowData();
    }
    
    close() {
        this.element.style.display = "none";
    }

    /**
     * Load workflow data and display missing models
     */
    async loadWorkflowData(workflow = null) {
        if (!this.contentElement) return;

        // Show loading state
        this.contentElement.innerHTML = '<p>Analyzing workflow...</p>';

        try {
            // Use provided workflow, or get current workflow from ComfyUI
            if (!workflow) {
                workflow = this.getCurrentWorkflow();
            }
            
            if (!workflow) {
                this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                return;
            }

            // Call analyze endpoint
            const response = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            this.displayMissingModels(this.contentElement, data);

        } catch (error) {
            console.error('Model Linker: Error loading workflow data:', error);
            if (this.contentElement) {
                this.contentElement.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
            }
        }
    }

    /**
     * Get current workflow from ComfyUI
     */
    getCurrentWorkflow() {
        // Try to get workflow from app
        if (app?.graph) {
            try {
                // Use ComfyUI's workflow serialization
                const workflow = app.graph.serialize();
                return workflow;
            } catch (e) {
                console.warn('Model Linker: Could not serialize workflow from graph:', e);
            }
        }
        return null;
    }

    /**
     * Display missing models in the dialog
     */
    displayMissingModels(container, data) {
        const missingModels = data.missing_models || [];
        const totalMissing = data.total_missing || 0;

        if (totalMissing === 0) {
            container.innerHTML = '<p style="color: green;">✓ No missing models found. All models are available!</p>';
            return;
        }

        let html = `<p><strong>Found ${totalMissing} missing model(s):</strong></p>`;
        html += '<div style="display: flex; flex-direction: column; gap: 16px;">';

        // Sort missing models: those with 100% confidence matches first, then others
        const sortedMissingModels = missingModels.sort((a, b) => {
            const aMatches = a.matches || [];
            const bMatches = b.matches || [];
            
            // Filter to 70%+ confidence
            const aFiltered = aMatches.filter(m => m.confidence >= 70);
            const bFiltered = bMatches.filter(m => m.confidence >= 70);
            
            // Check if they have 100% matches
            const aHas100 = aFiltered.some(m => m.confidence === 100);
            const bHas100 = bFiltered.some(m => m.confidence === 100);
            
            // If one has 100% and the other doesn't, prioritize the one with 100%
            if (aHas100 && !bHas100) return -1;
            if (!aHas100 && bHas100) return 1;
            
            // If both have 100% or neither has 100%, sort by best confidence
            const aBestConf = aFiltered.length > 0 ? Math.max(...aFiltered.map(m => m.confidence)) : 0;
            const bBestConf = bFiltered.length > 0 ? Math.max(...bFiltered.map(m => m.confidence)) : 0;
            
            return bBestConf - aBestConf; // Higher confidence first
        });

        for (const missing of sortedMissingModels) {
            html += this.renderMissingModel(missing);
        }

        html += '</div>';
        container.innerHTML = html;

        // Attach event listeners for resolve buttons (use sorted order)
        // Note: We need to match the exact same logic as renderMissingModel to find which buttons were rendered
        sortedMissingModels.forEach((missing, missingIndex) => {
            const allMatches = missing.matches || [];
            
            // Filter out matches below 70% confidence threshold
            const filteredMatches = allMatches.filter(m => m.confidence >= 70);
            
            // Filter to only 100% matches if available, otherwise use filtered matches (>=70%)
            const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
            const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);
            
            // Match the same logic as renderMissingModel
            const matchesToShow = perfectMatches.length > 0 
                ? perfectMatches 
                : otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
            
            // Sort: 100% matches first, then by confidence descending (same as renderMissingModel)
            const sortedMatches = matchesToShow.sort((a, b) => {
                if (a.confidence === 100 && b.confidence !== 100) return -1;
                if (a.confidence !== 100 && b.confidence === 100) return 1;
                return b.confidence - a.confidence;
            });
            
            sortedMatches.forEach((match, matchIndex) => {
                // Attach listener to all matches (all now have resolve buttons)
                const buttonId = `resolve-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
                const resolveButton = container.querySelector(`#${buttonId}`);
                if (resolveButton) {
                    resolveButton.addEventListener('click', () => {
                        this.resolveModel(missing, match.model);
                    });
                }
            });
        });
    }

    /**
     * Render a single missing model entry
     */
    renderMissingModel(missing) {
        const allMatches = missing.matches || [];
        
        // Filter out matches below 70% confidence threshold
        const filteredMatches = allMatches.filter(m => m.confidence >= 70);
        const hasMatches = filteredMatches.length > 0;

        let html = `<div style="border: 1px solid var(--border-color, #444); padding: 12px; border-radius: 4px;">`;
        
        // Display subgraph name as primary identifier if available, otherwise show node type
        // A node type that's a UUID indicates it's a subgraph instance
        const isSubgraphNode = missing.node_type && missing.node_type.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        
        if (missing.subgraph_name) {
            // Show subgraph name as primary identifier
            html += `<div style="margin-bottom: 8px;"><strong>Subgraph:</strong> ${missing.subgraph_name} (ID: ${missing.node_id})</div>`;
        } else if (isSubgraphNode) {
            // Node type is a UUID (subgraph) but we don't have the name (shouldn't happen, but handle gracefully)
            html += `<div style="margin-bottom: 8px;"><strong>Node:</strong> <em>Subgraph</em> (ID: ${missing.node_id})</div>`;
        } else {
            // Regular node
            html += `<div style="margin-bottom: 8px;"><strong>Node:</strong> ${missing.node_type} (ID: ${missing.node_id})</div>`;
        }
        html += `<div style="margin-bottom: 8px;"><strong>Missing Model:</strong> <code>${missing.original_path}</code></div>`;
        html += `<div style="margin-bottom: 8px;"><strong>Category:</strong> ${missing.category || 'unknown'}</div>`;

        if (hasMatches) {
            // Filter out matches below 70% confidence threshold
            const filteredMatches = allMatches.filter(m => m.confidence >= 70);
            
            // Separate 100% matches from others (from filtered list)
            const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
            const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);
            
            // If we have 100% matches, only show those. Otherwise, show other matches sorted by confidence
            const matchesToShow = perfectMatches.length > 0 
                ? perfectMatches 
                : otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
            
            html += `<div style="margin-top: 12px;"><strong>Suggested Matches:</strong></div>`;
            html += '<ul style="margin: 8px 0; padding-left: 20px;">';
            
            // Sort: 100% matches first, then by confidence descending
            const sortedMatches = matchesToShow.sort((a, b) => {
                if (a.confidence === 100 && b.confidence !== 100) return -1;
                if (a.confidence !== 100 && b.confidence === 100) return 1;
                return b.confidence - a.confidence;
            });
            
            for (let matchIndex = 0; matchIndex < sortedMatches.length; matchIndex++) {
                const match = sortedMatches[matchIndex];
                const buttonId = `resolve-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
                html += `<li style="margin: 4px 0;">`;
                html += `<code>${match.model?.relative_path || match.filename}</code> `;
                html += `<span style="color: ${match.confidence === 100 ? 'green' : 'orange'};">
                    (${match.confidence}% confidence)
                </span>`;
                // Show resolve button for all matches (100% or < 100%)
                html += ` <button id="${buttonId}" 
                    class="model-linker-resolve-btn" style="margin-left: 8px; padding: 4px 8px;">
                    Resolve
                </button>`;
                html += `</li>`;
            }
            
            html += '</ul>';
            
            // Add note if only showing 100% matches
            if (perfectMatches.length > 0 && otherMatches.length > 0) {
                html += `<div style="color: #888; font-size: 12px; margin-top: 8px; font-style: italic;">Showing only 100% confidence matches. ${otherMatches.length} other match${otherMatches.length > 1 ? 'es' : ''} available.</div>`;
            }
        } else if (allMatches.length > 0 && filteredMatches.length === 0) {
            // Had matches but all were below 70% threshold
            html += `<div style="color: orange; margin-top: 8px;">No matches found above 70% confidence threshold.</div>`;
        } else {
            html += `<div style="color: orange; margin-top: 8px;">No matches found.</div>`;
        }

        html += '</div>';
        return html;
    }

    /**
     * Show a notification banner (similar to ComfyUI's "Reconnecting" banner)
     */
    showNotification(message, type = 'success') {
        // Create notification banner
        const notification = $el("div", {
            style: {
                position: "fixed",
                top: "0",
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007acc',
                color: "#ffffff",
                padding: "12px 24px",
                borderRadius: "0 0 8px 8px",
                fontSize: "14px",
                fontWeight: "500",
                zIndex: "100000",
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                minWidth: "300px",
                maxWidth: "600px",
                textAlign: "center",
                animation: "slideDown 0.3s ease"
            }
        }, [
            type === 'success' ? $el("span", {
                textContent: "✓",
                style: {
                    fontSize: "18px",
                    fontWeight: "bold"
                }
            }) : type === 'error' ? $el("span", {
                textContent: "×",
                style: {
                    fontSize: "18px",
                    fontWeight: "bold"
                }
            }) : null,
            $el("span", {
                textContent: message
            }),
            $el("button", {
                textContent: "×",
                onclick: () => {
                    if (notification.parentNode) {
                        notification.style.opacity = "0";
                        notification.style.transform = "translateX(-50%) translateY(-100%)";
                        setTimeout(() => {
                            if (notification.parentNode) {
                                notification.parentNode.removeChild(notification);
                            }
                        }, 300);
                    }
                },
                style: {
                    background: "none",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "20px",
                    cursor: "pointer",
                    padding: "0",
                    marginLeft: "auto",
                    opacity: "0.8",
                    width: "24px",
                    height: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px"
                }
            })
        ]);

        // Add CSS animation if not already added
        if (!document.getElementById('model-linker-notification-style')) {
            const style = $el("style", {
                id: 'model-linker-notification-style',
                textContent: `
                    @keyframes slideDown {
                        from {
                            opacity: 0;
                            transform: translateX(-50%) translateY(-100%);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(-50%) translateY(0);
                        }
                    }
                `
            });
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Auto-dismiss after 4 seconds for success, 6 seconds for errors
        const dismissTime = type === 'success' ? 4000 : 6000;
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = "0";
                notification.style.transform = "translateX(-50%) translateY(-100%)";
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, dismissTime);
    }

    /**
     * Resolve a single model
     */
    async resolveModel(missing, resolvedModel) {
        if (!resolvedModel) {
            this.showNotification('No resolved model selected', 'error');
            return;
        }

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            const resolution = {
                node_id: missing.node_id,
                widget_index: missing.widget_index,
                resolved_path: resolvedModel.path,
                category: missing.category,
                resolved_model: resolvedModel,
                subgraph_id: missing.subgraph_id,  // Include subgraph_id for subgraph nodes
                is_top_level: missing.is_top_level  // True for top-level nodes, False for nodes in subgraph definitions
            };

            const response = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow,
                    resolutions: [resolution]
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update workflow in ComfyUI
                await this.updateWorkflowInComfyUI(data.workflow);
                
                // Show success notification
                const modelName = resolvedModel.relative_path || resolvedModel.filename || 'model';
                this.showNotification(`✓ Model linked successfully: ${modelName}`, 'success');
                
                // Reload dialog using the updated workflow from API response
                // This ensures we're analyzing the correct updated workflow
                await this.loadWorkflowData(data.workflow);
            } else {
                this.showNotification('Failed to resolve model: ' + (data.error || 'Unknown error'), 'error');
            }

        } catch (error) {
            console.error('Model Linker: Error resolving model:', error);
            this.showNotification('Error resolving model: ' + error.message, 'error');
        }
    }

    /**
     * Auto-resolve all 100% confidence matches
     */
    async autoResolve100Percent() {
        if (!this.contentElement) return;

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            // Analyze workflow first
            const analyzeResponse = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!analyzeResponse.ok) {
                throw new Error(`API error: ${analyzeResponse.status}`);
            }

            const analyzeData = await analyzeResponse.json();
            const missingModels = analyzeData.missing_models || [];

            // Collect all 100% matches
            const resolutions = [];
            for (const missing of missingModels) {
                const matches = missing.matches || [];
                const perfectMatch = matches.find((m) => m.confidence === 100);
                
                if (perfectMatch && perfectMatch.model) {
                    resolutions.push({
                        node_id: missing.node_id,
                        widget_index: missing.widget_index,
                        resolved_path: perfectMatch.model.path,
                        category: missing.category,
                        resolved_model: perfectMatch.model,
                        subgraph_id: missing.subgraph_id,  // Include subgraph_id for subgraph nodes
                        is_top_level: missing.is_top_level  // True for top-level nodes, False for nodes in subgraph definitions
                    });
                }
            }

            if (resolutions.length === 0) {
                this.showNotification('No 100% confidence matches found to auto-resolve.', 'error');
                return;
            }

            // Apply resolutions
            const resolveResponse = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow,
                    resolutions
                })
            });

            if (!resolveResponse.ok) {
                throw new Error(`API error: ${resolveResponse.status}`);
            }

            const resolveData = await resolveResponse.json();
            
            if (resolveData.success) {
                // Update workflow in ComfyUI
                await this.updateWorkflowInComfyUI(resolveData.workflow);
                
                // Show success notification
                this.showNotification(
                    `✓ Successfully linked ${resolutions.length} model${resolutions.length > 1 ? 's' : ''}!`,
                    'success'
                );
                
                // Reload dialog using the updated workflow from API response
                // This ensures we're analyzing the correct updated workflow
                await this.loadWorkflowData(resolveData.workflow);
            } else {
                this.showNotification('Failed to resolve models: ' + (resolveData.error || 'Unknown error'), 'error');
            }

        } catch (error) {
            console.error('Model Linker: Error auto-resolving:', error);
            this.showNotification('Error auto-resolving: ' + error.message, 'error');
        }
    }

    /**
     * Update workflow in ComfyUI's UI/memory
     * Updates the current workflow in place instead of creating a new tab
     */
    async updateWorkflowInComfyUI(workflow) {
        if (!app || !app.graph) {
            console.warn('Model Linker: Could not update workflow - app or app.graph not available');
            return;
        }

        try {
            // Method 1: Try to directly update the current graph using configure
            // This is the most direct way to update in place
            if (app.graph && typeof app.graph.configure === 'function') {
                app.graph.configure(workflow);
                return;
            }

            // Method 2: Try deserialize to update the graph in place
            if (app.graph && typeof app.graph.deserialize === 'function') {
                app.graph.deserialize(workflow);
                return;
            }

            // Method 3: Use loadGraphData with explicit parameters to update current tab
            // The key is to NOT create a new workflow - pass null or undefined for the workflow parameter
            // clean=false means don't clear the graph first
            // restore_view=false means don't restore the viewport
            // workflow=null means update current workflow instead of creating new one
            if (app.loadGraphData) {
                // Try with null as 4th parameter first
                await app.loadGraphData(workflow, false, false, null);
                return;
            }

            console.warn('Model Linker: No method available to update workflow');
        } catch (error) {
            console.error('Model Linker: Error updating workflow in ComfyUI:', error);
            // Don't throw - allow the workflow update to continue even if UI update fails
            // The backend has already updated the workflow data
        }
    }
}

// Main extension class
class ModelLinker {
    constructor() {
        this.linkerButton = null;
        this.buttonId = "model-linker-button";
        this.dialog = null;
    }

    setup = () => {
        // Remove any existing button
        this.removeExistingButton();

        // Find a visible menu element
        const allMenus = document.querySelectorAll("[class*='menu']");

        // Try to find a visible menu
        let visibleMenu = null;
        for (const menu of allMenus) {
            const style = window.getComputedStyle(menu);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                visibleMenu = menu;
                break;
            }
        }

        // Try alternative: app.menu.settingsGroup
        if (!visibleMenu && app.menu?.settingsGroup?.element) {
            visibleMenu = app.menu.settingsGroup.element.parentElement;
        }

        // Try alternative selectors for the top bar
        if (!visibleMenu) {
            const alternatives = [
                'header',
                '.header',
                '.top-bar',
                '.toolbar',
                '.nav',
                '.navigation',
                '[role="toolbar"]',
                '[role="menubar"]'
            ];

            for (const selector of alternatives) {
                const element = document.querySelector(selector);
                if (element) {
                    const style = window.getComputedStyle(element);
                    if (style.display !== 'none' && style.visibility !== 'hidden') {
                        visibleMenu = element;
                        break;
                    }
                }
            }
        }

        if (visibleMenu) {
            this.createLinkerButton(visibleMenu);
        } else {
            this.createFloatingButton();
        }

        // Create dialog instance (will be created on demand)
        if (!this.dialog) {
            this.dialog = new LinkerManagerDialog();
        }
    }

    removeExistingButton() {
        // Remove any existing button by ID
        const existingButton = document.getElementById(this.buttonId);
        if (existingButton) {
            existingButton.remove();
        }

        // Also remove the stored reference if it exists
        if (this.linkerButton && this.linkerButton.parentNode) {
            this.linkerButton.remove();
            this.linkerButton = null;
        }
    }

    createLinkerButton(menu) {
        this.linkerButton = $el("button", {
            id: this.buttonId,
            textContent: "🔗 Model Linker",
            title: "Open Model Linker to resolve missing models in workflow",
            onclick: () => {
                this.openLinkerManager();
            },
            style: {
                backgroundColor: "var(--comfy-input-bg, #353535)",
                color: "var(--input-text, #ffffff)",
                border: "2px solid var(--border-color, #555555)",
                padding: "8px 16px",
                margin: "4px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "600",
                display: "inline-block",
                minWidth: "80px",
                textAlign: "center",
                zIndex: "1000",
                position: "relative",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap"
            }
        });

        // Add hover effects
        this.linkerButton.addEventListener("mouseenter", () => {
            this.linkerButton.style.backgroundColor = "var(--comfy-input-bg-hover, #4a4a4a)";
            this.linkerButton.style.borderColor = "var(--primary-color, #007acc)";
            this.linkerButton.style.transform = "translateY(-1px)";
            this.linkerButton.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
        });

        this.linkerButton.addEventListener("mouseleave", () => {
            this.linkerButton.style.backgroundColor = "var(--comfy-input-bg, #353535)";
            this.linkerButton.style.borderColor = "var(--border-color, #555555)";
            this.linkerButton.style.transform = "translateY(0)";
            this.linkerButton.style.boxShadow = "none";
        });

        // Try to insert before settings group if using app.menu
        if (app.menu?.settingsGroup?.element && menu === app.menu.settingsGroup.element.parentElement) {
            app.menu.settingsGroup.element.before(this.linkerButton);
        } else {
            menu.appendChild(this.linkerButton);
        }
    }

    createFloatingButton() {
        // Create a floating button as fallback
        this.linkerButton = $el("button", {
            id: this.buttonId,
            textContent: "🔗 Model Linker",
            title: "Open Model Linker to resolve missing models in workflow",
            onclick: () => {
                this.openLinkerManager();
            },
            style: {
                position: "fixed",
                top: "10px",
                right: "10px",
                zIndex: "10000",
                backgroundColor: "var(--comfy-input-bg, #353535)",
                color: "var(--input-text, #ffffff)",
                border: "2px solid var(--primary-color, #007acc)",
                padding: "8px 16px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "600",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap"
            }
        });

        // Add hover effects
        this.linkerButton.addEventListener("mouseenter", () => {
            this.linkerButton.style.backgroundColor = "var(--primary-color, #007acc)";
            this.linkerButton.style.transform = "scale(1.05)";
        });

        this.linkerButton.addEventListener("mouseleave", () => {
            this.linkerButton.style.backgroundColor = "var(--comfy-input-bg, #353535)";
            this.linkerButton.style.transform = "scale(1)";
        });

        document.body.appendChild(this.linkerButton);
    }

    openLinkerManager() {
        try {
            if (!this.dialog) {
                this.dialog = new LinkerManagerDialog();
            }
            this.dialog.show();
        } catch (error) {
            console.error("🔗 Model Linker: Error creating/showing dialog:", error);
            alert("Error opening Model Linker: " + error.message);
        }
    }
}

const modelLinker = new ModelLinker();

// Register the extension
app.registerExtension({
    name: "Model Linker",
    setup: modelLinker.setup,
	commands: [
		{
			id: "openModelLinker",
			label: "Open Model Linker",
			function: modelLinker.openLinkerManager
		}
	],
	keybindings: [
		{
			combo: { key: "l", ctrl: true, shift: true },
			commandId: "openModelLinker"
		}
	]
});
