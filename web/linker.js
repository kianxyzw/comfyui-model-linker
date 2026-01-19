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

class LinkerManagerDialog extends ComfyDialog {
    constructor() {
        super();
        this.currentWorkflow = null;
        this.missingModels = [];
        this.activeDownloads = {};  // Track active downloads
        this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
        
        // Inject global styles for the redesigned UI
        this.injectStyles();
        
        // Create backdrop overlay for click-outside-to-close
        this.backdrop = $el("div.model-linker-backdrop", {
            parent: document.body,
            style: {
                position: "fixed",
                top: "0",
                left: "0",
                width: "100vw",
                height: "100vh",
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                zIndex: "99998",
                display: "none"
            }
        });
        
        // Create dialog element using $el
        this.element = $el("div.comfy-modal", {
            parent: document.body,
            style: {
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "1100px",
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
        
        // Add click listener to backdrop
        this.backdrop.addEventListener('click', () => this.close());
    }
    
    /**
     * Inject global CSS styles for the Model Linker UI
     */
    injectStyles() {
        // Only inject once
        if (document.getElementById('model-linker-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'model-linker-styles';
        styles.textContent = `
            /* CSS Variables for Model Linker */
            :root {
                --ml-bg: #222;
                --ml-card-bg: #2a2a2a;
                --ml-card-bg-alt: #252525;
                --ml-border: #3a3a3a;
                --ml-text: #e0e0e0;
                --ml-text-muted: #888;
                --ml-text-dim: #666;
                --ml-accent: #4CAF50;
                --ml-accent-hover: #45a049;
                --ml-confidence-high: #4CAF50;
                --ml-confidence-medium: #FFC107;
                --ml-confidence-low: #f44336;
                --ml-link-color: #8ab4f8;
            }
            
            /* Card Styles */
            .ml-card {
                background: var(--ml-card-bg);
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 12px;
                transition: background 0.2s ease;
            }
            .ml-card:nth-child(even) {
                background: var(--ml-card-bg-alt);
            }
            .ml-card:hover {
                background: #303030;
            }
            
            /* Card Header */
            .ml-card-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 12px;
            }
            .ml-card-title {
                font-size: 15px;
                font-weight: 600;
                color: var(--ml-text);
                margin: 0;
                word-break: break-word;
                flex: 1;
            }
            .ml-node-chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                background: #3a3a3a;
                border-radius: 4px;
                font-size: 11px;
                color: var(--ml-text-muted);
                white-space: nowrap;
                flex-shrink: 0;
            }
            .ml-category-chip {
                display: inline-flex;
                padding: 2px 6px;
                background: #444;
                border-radius: 3px;
                font-size: 10px;
                color: var(--ml-text-muted);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            /* Two-Column Layout */
            .ml-columns {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }
            @media (max-width: 700px) {
                .ml-columns {
                    grid-template-columns: 1fr;
                }
            }
            .ml-column {
                min-width: 0;
            }
            .ml-column-header {
                font-size: 11px;
                font-weight: 600;
                color: var(--ml-text-muted);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid var(--ml-border);
            }
            
            /* Filename Chips */
            .ml-chip {
                display: inline-flex;
                align-items: center;
                padding: 4px 10px;
                background: #3a3a3a;
                border-radius: 6px;
                font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
                font-size: 12px;
                color: var(--ml-text);
                max-width: 100%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .ml-chip:hover {
                background: #444;
            }
            
            /* Confidence Badges */
            .ml-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                color: white;
                min-width: 42px;
                text-align: center;
            }
            .ml-badge-high {
                background: var(--ml-confidence-high);
            }
            .ml-badge-medium {
                background: var(--ml-confidence-medium);
                color: #333;
            }
            .ml-badge-low {
                background: var(--ml-confidence-low);
            }
            
            /* Match Row */
            .ml-match-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px;
                border-radius: 6px;
                margin-bottom: 6px;
                background: rgba(255,255,255,0.02);
                transition: background 0.15s ease;
            }
            .ml-match-row:hover {
                background: rgba(255,255,255,0.05);
            }
            .ml-match-row.ml-best-match {
                background: rgba(76, 175, 80, 0.1);
                border-left: 3px solid var(--ml-confidence-high);
                padding-left: 10px;
            }
            .ml-match-filename {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
                font-size: 12px;
                color: var(--ml-text);
            }
            
            /* Buttons */
            .ml-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 6px 12px;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
            }
            .ml-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .ml-btn-primary {
                background: var(--ml-accent);
                color: white;
            }
            .ml-btn-primary:hover:not(:disabled) {
                background: var(--ml-accent-hover);
            }
            .ml-btn-secondary {
                background: transparent;
                color: var(--ml-text);
                border: 1px solid var(--ml-border);
            }
            .ml-btn-secondary:hover:not(:disabled) {
                background: rgba(255,255,255,0.05);
                border-color: #555;
            }
            .ml-btn-link {
                background: #2196F3;
                color: white;
            }
            .ml-btn-link:hover:not(:disabled) {
                background: #1976D2;
            }
            .ml-btn-download {
                background: var(--ml-accent);
                color: white;
            }
            .ml-btn-download:hover:not(:disabled) {
                background: var(--ml-accent-hover);
            }
            .ml-btn-danger {
                background: #f44336;
                color: white;
            }
            .ml-btn-danger:hover:not(:disabled) {
                background: #d32f2f;
            }
            .ml-btn-sm {
                padding: 4px 8px;
                font-size: 11px;
            }
            .ml-btn-icon {
                font-size: 14px;
            }
            
            /* Download Section */
            .ml-download-section {
                padding: 12px;
                background: rgba(76, 175, 80, 0.05);
                border-radius: 6px;
                border: 1px dashed var(--ml-border);
            }
            .ml-download-info {
                font-size: 12px;
                color: var(--ml-text-muted);
                margin-top: 6px;
            }
            .ml-download-source {
                color: var(--ml-accent);
                font-weight: 500;
            }
            .ml-download-size {
                color: var(--ml-text-dim);
                margin-left: 8px;
            }
            
            /* Status Messages */
            .ml-status {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px 14px;
                border-radius: 6px;
                font-size: 13px;
                margin-top: 8px;
            }
            .ml-status-icon {
                font-size: 16px;
                flex-shrink: 0;
            }
            .ml-status-error {
                background: rgba(244, 67, 54, 0.1);
                border: 1px solid rgba(244, 67, 54, 0.3);
                color: #ef9a9a;
            }
            .ml-status-success {
                background: rgba(76, 175, 80, 0.1);
                border: 1px solid rgba(76, 175, 80, 0.3);
                color: #a5d6a7;
            }
            .ml-status-info {
                background: rgba(33, 150, 243, 0.1);
                border: 1px solid rgba(33, 150, 243, 0.3);
                color: #90caf9;
            }
            .ml-status-warning {
                background: rgba(255, 152, 0, 0.1);
                border: 1px solid rgba(255, 152, 0, 0.3);
                color: #ffcc80;
            }
            
            /* Progress Bar */
            .ml-progress-container {
                margin-top: 8px;
            }
            .ml-progress-bar {
                height: 6px;
                background: #333;
                border-radius: 3px;
                overflow: hidden;
            }
            .ml-progress-fill {
                height: 100%;
                background: var(--ml-accent);
                transition: width 0.3s ease;
            }
            .ml-progress-text {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 6px;
                font-size: 11px;
                color: var(--ml-text-muted);
            }
            
            /* Scrollbar */
            .ml-scrollable {
                overflow-y: auto;
            }
            .ml-scrollable::-webkit-scrollbar {
                width: 8px;
            }
            .ml-scrollable::-webkit-scrollbar-track {
                background: transparent;
            }
            .ml-scrollable::-webkit-scrollbar-thumb {
                background: #444;
                border-radius: 4px;
            }
            .ml-scrollable::-webkit-scrollbar-thumb:hover {
                background: #555;
            }
            
            /* Footer */
            .ml-footer {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 10px;
                padding: 16px 20px;
                background: linear-gradient(to top, var(--ml-bg) 0%, var(--ml-bg) 70%, transparent 100%);
                border-top: 1px solid var(--ml-border);
            }
            
            /* No matches text */
            .ml-no-matches {
                color: var(--ml-text-muted);
                font-size: 12px;
                font-style: italic;
                padding: 8px 0;
            }
            
            /* Link styling */
            .ml-link {
                color: var(--ml-link-color);
                text-decoration: none;
            }
            .ml-link:hover {
                text-decoration: underline;
            }
        `;
        
        document.head.appendChild(styles);
    }
    
    /**
     * Get a colored confidence badge HTML
     * @param {number} confidence - Confidence percentage (0-100)
     * @returns {string} HTML for the badge
     */
    getConfidenceBadge(confidence) {
        let badgeClass;
        if (confidence >= 95) {
            badgeClass = 'ml-badge-high';
        } else if (confidence >= 70) {
            badgeClass = 'ml-badge-medium';
        } else {
            badgeClass = 'ml-badge-low';
        }
        return `<span class="ml-badge ${badgeClass}">${confidence}%</span>`;
    }
    
    /**
     * Format a filename with smart truncation
     * @param {string} path - Full path or filename
     * @param {number} maxLength - Maximum display length
     * @returns {object} { display: truncated name, full: full name }
     */
    formatFilename(path, maxLength = 50) {
        if (!path) return { display: 'Unknown', full: 'Unknown' };
        
        // Extract just the filename from path
        const filename = path.split(/[\/\\]/).pop() || path;
        
        if (filename.length <= maxLength) {
            return { display: filename, full: filename };
        }
        
        // Smart truncation: keep extension visible
        const lastDot = filename.lastIndexOf('.');
        const ext = lastDot > 0 ? filename.slice(lastDot) : '';
        const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;
        
        // Calculate how much of the name we can show
        const availableLength = maxLength - ext.length - 3; // 3 for "..."
        if (availableLength < 8) {
            // Too short, just truncate at the end
            return { display: filename.slice(0, maxLength - 3) + '...', full: filename };
        }
        
        // Truncate middle of name
        const frontLength = Math.ceil(availableLength / 2);
        const backLength = Math.floor(availableLength / 2);
        const truncated = name.slice(0, frontLength) + '...' + name.slice(-backLength) + ext;
        
        return { display: truncated, full: filename };
    }
    
    /**
     * Format a path showing directory context
     * @param {string} path - Full relative path
     * @param {number} maxLength - Maximum display length
     * @returns {object} { display: formatted path, full: full path }
     */
    formatPath(path, maxLength = 60) {
        if (!path) return { display: 'Unknown', full: 'Unknown' };
        
        if (path.length <= maxLength) {
            return { display: path, full: path };
        }
        
        // Try to show meaningful parts: first dir + filename
        const parts = path.split(/[\/\\]/);
        const filename = parts.pop() || '';
        const firstDir = parts[0] || '';
        
        if (parts.length === 0) {
            // Just a filename
            return this.formatFilename(path, maxLength);
        }
        
        // Show first directory + ... + filename
        const formatted = firstDir + '\\...' + (filename.length > 40 ? this.formatFilename(filename, 40).display : filename);
        
        if (formatted.length <= maxLength) {
            return { display: formatted, full: path };
        }
        
        // Still too long, just truncate
        return { display: path.slice(0, maxLength - 3) + '...', full: path };
    }
    
    /**
     * Render a status message with icon
     * @param {string} message - Message text
     * @param {string} type - 'error' | 'success' | 'info' | 'warning'
     * @returns {string} HTML for status message
     */
    renderStatusMessage(message, type = 'info') {
        const icons = {
            error: '⚠',
            success: '✓',
            info: 'ℹ',
            warning: '⚡'
        };
        const icon = icons[type] || icons.info;
        
        return `
            <div class="ml-status ml-status-${type}">
                <span class="ml-status-icon">${icon}</span>
                <span>${message}</span>
            </div>
        `;
    }
    
    /**
     * Render a progress bar
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} leftText - Text on the left
     * @param {string} rightText - Text on the right
     * @returns {string} HTML for progress bar
     */
    renderProgressBar(percent, leftText = '', rightText = '') {
        return `
            <div class="ml-progress-container">
                <div class="ml-progress-bar">
                    <div class="ml-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="ml-progress-text">
                    <span>${leftText}</span>
                    <span>${rightText}</span>
                </div>
            </div>
        `;
    }
    
    /**
     * Handle clicks outside the dialog
     */
    handleOutsideClick(e) {
        // Close if click is on the backdrop (not on the dialog itself)
        if (e.target === this.backdrop) {
            this.close();
        }
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
        this.contentElement = $el("div.ml-scrollable", {
            id: "model-linker-content",
            style: {
                padding: "20px",
                overflowY: "auto",
                flex: "1",
                minHeight: "0",
                backgroundColor: "var(--ml-bg, #222)"
            }
        });
        return this.contentElement;
    }
    
    createFooter() {
        // Store reference to download all button so we can update its text
        this.downloadAllButton = $el("button.ml-btn.ml-btn-download", {
            onclick: () => this.handleDownloadAllClick(),
            style: {
                padding: "10px 20px",
                fontSize: "13px"
            }
        }, [
            $el("span.ml-btn-icon", { textContent: "☁" }),
            $el("span", { textContent: " Download All Missing" })
        ]);
        
        // Auto-resolve button (secondary style)
        this.autoResolveButton = $el("button.ml-btn.ml-btn-secondary", {
            onclick: () => this.autoResolve100Percent(),
            style: {
                padding: "10px 20px",
                fontSize: "13px"
            }
        }, [
            $el("span.ml-btn-icon", { textContent: "🔗" }),
            $el("span", { textContent: " Auto-Link 100%" })
        ]);
        
        return $el("div.ml-footer", {
            style: {
                position: "sticky",
                bottom: "0",
                backgroundColor: "var(--ml-bg, #222)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)"
            }
        }, [
            this.autoResolveButton,
            this.downloadAllButton
        ]);
    }
    
    /**
     * Handle click on Download All / Cancel All button
     */
    handleDownloadAllClick() {
        if (Object.keys(this.activeDownloads).length > 0) {
            // Cancel all active downloads
            this.cancelAllDownloads();
        } else {
            // Start downloading all missing
            this.downloadAllMissing();
        }
    }
    
    /**
     * Cancel all active downloads
     */
    async cancelAllDownloads() {
        const downloadIds = Object.keys(this.activeDownloads);
        if (downloadIds.length === 0) return;
        
        this.showNotification(`Cancelling ${downloadIds.length} download${downloadIds.length > 1 ? 's' : ''}...`, 'info');
        
        for (const downloadId of downloadIds) {
            try {
                await api.fetchApi(`/model_linker/cancel/${downloadId}`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Model Linker: Error cancelling download:', error);
            }
        }
    }
    
    /**
     * Update the Download All button state based on active downloads
     */
    updateDownloadAllButtonState() {
        if (!this.downloadAllButton) return;
        
        const activeCount = Object.keys(this.activeDownloads).length;
        if (activeCount > 0) {
            this.downloadAllButton.innerHTML = `<span class="ml-btn-icon">✕</span> Cancel All (${activeCount})`;
            this.downloadAllButton.classList.remove('ml-btn-download');
            this.downloadAllButton.classList.add('ml-btn-danger');
        } else {
            this.downloadAllButton.innerHTML = `<span class="ml-btn-icon">☁</span> Download All Missing`;
            this.downloadAllButton.classList.remove('ml-btn-danger');
            this.downloadAllButton.classList.add('ml-btn-download');
        }
    }
    
    async show(workflow = null) {
        this.backdrop.style.display = "block";
        this.element.style.display = "flex";
        
        // Update button state in case there are active downloads
        this.updateDownloadAllButtonState();
        
        // Use provided workflow or fetch from current graph
        await this.loadWorkflowData(workflow);
    }
    
    close() {
        this.backdrop.style.display = "none";
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
            
            // Reconnect any active downloads to their new progress divs
            this.reconnectActiveDownloads();

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
     * Reconnect active downloads to their new progress div elements after UI refresh
     */
    reconnectActiveDownloads() {
        if (!this.contentElement) return;
        
        for (const [downloadId, info] of Object.entries(this.activeDownloads)) {
            const { missing } = info;
            if (!missing) continue;
            
            // Find the new progress div by ID
            const progressId = `download-progress-${missing.node_id}-${missing.widget_index}`;
            const newProgressDiv = this.contentElement.querySelector(`#${progressId}`);
            const newDownloadBtn = this.contentElement.querySelector(`#download-${missing.node_id}-${missing.widget_index}`);
            
            if (newProgressDiv) {
                // Update the reference
                info.progressDiv = newProgressDiv;
                info.downloadBtn = newDownloadBtn;
                
                // Show that download is in progress
                newProgressDiv.style.display = 'block';
                newProgressDiv.innerHTML = `
                    <div class="ml-progress-container">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="ml-progress-bar" style="flex: 1;">
                                <div class="ml-progress-fill" style="width: 0%;"></div>
                            </div>
                            <button class="cancel-download-btn ml-btn ml-btn-danger ml-btn-sm" data-download-id="${downloadId}">
                                Cancel
                            </button>
                        </div>
                        <div class="ml-progress-text">
                            <span style="color: #2196F3;">Downloading...</span>
                        </div>
                    </div>
                `;
                
                // Attach cancel handler
                const cancelBtn = newProgressDiv.querySelector('.cancel-download-btn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
                }
                
                // Update download button if exists
                if (newDownloadBtn) {
                    newDownloadBtn.disabled = true;
                    newDownloadBtn.textContent = 'Downloading...';
                }
            }
        }
    }
    
    /**
     * Display missing models in the dialog
     */
    displayMissingModels(container, data) {
        const missingModels = data.missing_models || [];
        const totalMissing = data.total_missing || 0;
        
        // Check if there are active downloads
        const activeCount = Object.keys(this.activeDownloads).length;
        
        // Check if any model has a 100% confidence match
        const hasAny100Match = missingModels.some(m => 
            (m.matches || []).some(match => match.confidence === 100)
        );
        
        // Show/hide Auto-Link button based on whether 100% matches exist
        if (this.autoResolveButton) {
            this.autoResolveButton.style.display = hasAny100Match ? 'inline-flex' : 'none';
        }
        
        // Hide download all button if no missing models
        if (this.downloadAllButton) {
            this.downloadAllButton.style.display = totalMissing > 0 ? 'inline-flex' : 'none';
        }

        if (totalMissing === 0 && activeCount === 0) {
            container.innerHTML = this.renderStatusMessage('All models are available! No missing models found.', 'success');
            return;
        }
        
        // If no missing models but downloads are active, show a waiting message
        if (totalMissing === 0 && activeCount > 0) {
            container.innerHTML = this.renderStatusMessage(
                `${activeCount} download${activeCount > 1 ? 's' : ''} in progress. Models will be auto-linked when complete.`,
                'info'
            );
            return;
        }

        // Summary header with count
        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--ml-border);">
                <div>
                    <span style="font-size: 15px; font-weight: 600; color: var(--ml-text);">
                        ${totalMissing} Missing Model${totalMissing > 1 ? 's' : ''}
                    </span>
                    ${activeCount > 0 ? `<span style="margin-left: 12px; color: var(--ml-text-muted); font-size: 12px;">${activeCount} downloading</span>` : ''}
                </div>
            </div>
        `;
        html += '<div style="display: flex; flex-direction: column; gap: 8px;">';

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
            
            // Attach download button listener
            const downloadBtnId = `download-${missing.node_id}-${missing.widget_index}`;
            const downloadBtn = container.querySelector(`#${downloadBtnId}`);
            if (downloadBtn && missing.download_source) {
                downloadBtn.addEventListener('click', () => {
                    this.downloadModel(missing);
                });
            }
            
            // Attach search button listener
            const searchBtnId = `search-${missing.node_id}-${missing.widget_index}`;
            const searchBtn = container.querySelector(`#${searchBtnId}`);
            if (searchBtn) {
                searchBtn.addEventListener('click', () => {
                    this.searchOnline(missing);
                });
            }
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
        
        // Calculate 100% matches upfront (needed for download section)
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
        const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);
        
        // Format the missing filename for display
        const missingFilename = this.formatFilename(missing.original_path, 60);
        
        // Determine node info for the chip
        const isSubgraphNode = missing.node_type && missing.node_type.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        let nodeLabel;
        if (missing.subgraph_name) {
            nodeLabel = missing.subgraph_name;
        } else if (isSubgraphNode) {
            nodeLabel = 'Subgraph';
        } else {
            nodeLabel = missing.node_type || 'Node';
        }
        
        // Start card
        let html = `<div class="ml-card">`;
        
        // Card Header: Filename as headline + node chip
        html += `<div class="ml-card-header">`;
        html += `<h3 class="ml-card-title" title="${missingFilename.full}">${missingFilename.display}</h3>`;
        html += `<div style="display: flex; align-items: center; gap: 6px;">`;
        if (missing.category) {
            html += `<span class="ml-category-chip">${missing.category}</span>`;
        }
        html += `<span class="ml-node-chip">${nodeLabel} #${missing.node_id}</span>`;
        html += `</div>`;
        html += `</div>`;
        
        // Two-column layout
        html += `<div class="ml-columns">`;
        
        // LEFT COLUMN: Local Matches
        html += `<div class="ml-column">`;
        html += `<div class="ml-column-header">Local Matches</div>`;
        
        if (hasMatches) {
            // If we have 100% matches, only show those. Otherwise, show other matches sorted by confidence
            const matchesToShow = perfectMatches.length > 0 
                ? perfectMatches 
                : otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
            
            // Sort: 100% matches first, then by confidence descending
            const sortedMatches = matchesToShow.sort((a, b) => {
                if (a.confidence === 100 && b.confidence !== 100) return -1;
                if (a.confidence !== 100 && b.confidence === 100) return 1;
                return b.confidence - a.confidence;
            });
            
            for (let matchIndex = 0; matchIndex < sortedMatches.length; matchIndex++) {
                const match = sortedMatches[matchIndex];
                const buttonId = `resolve-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
                const matchPath = match.model?.relative_path || match.filename || '';
                const formattedPath = this.formatPath(matchPath, 45);
                const isBestMatch = matchIndex === 0 && match.confidence >= 95;
                
                html += `<div class="ml-match-row ${isBestMatch ? 'ml-best-match' : ''}">`;
                html += this.getConfidenceBadge(match.confidence);
                html += `<span class="ml-match-filename" title="${formattedPath.full}">${formattedPath.display}</span>`;
                html += `<button id="${buttonId}" class="ml-btn ${isBestMatch ? 'ml-btn-primary' : 'ml-btn-secondary'} ml-btn-sm">`;
                html += `<span class="ml-btn-icon">🔗</span> Link`;
                html += `</button>`;
                html += `</div>`;
            }
            
            // Add note if only showing 100% matches
            if (perfectMatches.length > 0 && otherMatches.length > 0) {
                html += `<div class="ml-no-matches">${otherMatches.length} other match${otherMatches.length > 1 ? 'es' : ''} below 100%</div>`;
            }
        } else if (allMatches.length > 0 && filteredMatches.length === 0) {
            html += `<div class="ml-no-matches">No matches above 70% confidence</div>`;
        } else {
            html += `<div class="ml-no-matches">No local matches found</div>`;
        }
        
        html += `</div>`; // End left column
        
        // RIGHT COLUMN: Download Option
        html += `<div class="ml-column">`;
        html += `<div class="ml-column-header">Download</div>`;
        
        const filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        const downloadSource = missing.download_source;
        
        if (perfectMatches.length > 0) {
            // Has perfect local match - download not needed
            html += `<div class="ml-no-matches">Not needed - exact local match available</div>`;
        } else if (downloadSource && downloadSource.url) {
            // We have a known download URL
            const isExact = downloadSource.match_type === 'exact' || downloadSource.source === 'popular' || downloadSource.source === 'huggingface' || downloadSource.source === 'civitai';
            const isFromWorkflow = downloadSource.url_source === 'workflow';
            const sourceLabels = {
                'popular': 'Popular Models',
                'model_list': 'Model Database',
                'huggingface': 'HuggingFace',
                'civitai': 'CivitAI',
                'workflow': 'Workflow'
            };
            const sourceLabel = isFromWorkflow ? 'Workflow' : (sourceLabels[downloadSource.source] || 'Online');
            const downloadFilename = downloadSource.filename || filename;
            const formattedDownloadName = this.formatFilename(downloadFilename, 45);
            
            // Format file size
            let sizeDisplay = '';
            if (downloadSource.size) {
                if (typeof downloadSource.size === 'number') {
                    sizeDisplay = this.formatBytes(downloadSource.size);
                } else {
                    sizeDisplay = downloadSource.size;
                }
            }
            
            html += `<div class="ml-download-section">`;
            html += `<button id="download-${missing.node_id}-${missing.widget_index}" class="ml-btn ml-btn-download">`;
            html += `<span class="ml-btn-icon">☁</span> Download${sizeDisplay ? ` (${sizeDisplay})` : ''}`;
            html += `</button>`;
            html += `<div class="ml-download-info">`;
            html += `<span class="ml-download-source">${isFromWorkflow ? 'URL from workflow' : sourceLabel}</span>`;
            const modelCardUrl = this.getModelCardUrl(downloadSource.url);
            if (modelCardUrl) {
                html += `<br><a href="${modelCardUrl}" target="_blank" rel="noopener noreferrer" class="ml-link" title="Open model card">${formattedDownloadName.display}</a>`;
            } else {
                html += `<br><span title="${formattedDownloadName.full}">${formattedDownloadName.display}</span>`;
            }
            html += `</div>`;
            html += `</div>`;
        } else {
            // No known download - offer search
            html += `<div class="ml-download-section">`;
            html += `<button id="search-${missing.node_id}-${missing.widget_index}" class="ml-btn ml-btn-link">`;
            html += `<span class="ml-btn-icon">🔍</span> Search Online`;
            html += `</button>`;
            html += `<div class="ml-download-info">Search HuggingFace & CivitAI</div>`;
            html += `</div>`;
            html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" style="margin-top: 8px; display: none;"></div>`;
        }
        
        // Progress container (for downloads)
        html += `<div id="download-progress-${missing.node_id}-${missing.widget_index}" style="margin-top: 8px; display: none;"></div>`;
        
        html += `</div>`; // End right column
        html += `</div>`; // End columns
        
        html += `</div>`; // End card
        return html;
    }

    /**
     * Show a notification banner (similar to ComfyUI's "Reconnecting" banner)
     */
    showNotification(message, type = 'success') {
        // Build children array, filtering out nulls
        const children = [];
        
        if (type === 'success') {
            children.push($el("span", {
                textContent: "✓",
                style: {
                    fontSize: "18px",
                    fontWeight: "bold"
                }
            }));
        } else if (type === 'error') {
            children.push($el("span", {
                textContent: "×",
                style: {
                    fontSize: "18px",
                    fontWeight: "bold"
                }
            }));
        } else if (type === 'info') {
            children.push($el("span", {
                textContent: "ℹ",
                style: {
                    fontSize: "18px",
                    fontWeight: "bold"
                }
            }));
        }
        
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
            ...children,
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
     * Resolve a model - resolves ALL nodes that reference this model
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

            // Resolve ALL nodes that need this model (all_node_refs contains deduplicated refs)
            const nodeRefs = missing.all_node_refs || [missing];
            const resolutions = nodeRefs.map(ref => ({
                node_id: ref.node_id,
                widget_index: ref.widget_index,
                resolved_path: resolvedModel.path,
                category: ref.category,
                resolved_model: resolvedModel,
                subgraph_id: ref.subgraph_id,
                is_top_level: ref.is_top_level
            }));

            const response = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow,
                    resolutions: resolutions
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
                const count = resolutions.length;
                const refText = count > 1 ? ` (${count} references)` : '';
                this.showNotification(`✓ Model linked successfully: ${modelName}${refText}`, 'success');
                
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
     * @returns {object|null} The updated workflow if successful, null otherwise
     */
    async autoResolve100Percent() {
        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return null;
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
                return null;
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
                
                // Reload dialog using the updated workflow from API response (if dialog is visible)
                if (this.contentElement) {
                    await this.loadWorkflowData(resolveData.workflow);
                }
                
                // Return the updated workflow for callers who need it
                return resolveData.workflow;
            } else {
                this.showNotification('Failed to resolve models: ' + (resolveData.error || 'Unknown error'), 'error');
                return null;
            }

        } catch (error) {
            console.error('Model Linker: Error auto-resolving:', error);
            this.showNotification('Error auto-resolving: ' + error.message, 'error');
            return null;
        }
    }

    /**
     * Download all missing models that have download sources but no 100% local match
     */
    async downloadAllMissing() {
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

            // Collect models that need downloading:
            // - Have a download_source with valid URL
            // - Do NOT have any 100% confidence local matches
            const toDownload = [];
            for (const missing of missingModels) {
                const perfectMatches = (missing.matches || []).filter(m => m.confidence === 100);
                
                // Skip if has 100% local match or no download source
                if (perfectMatches.length > 0 || !missing.download_source?.url) {
                    continue;
                }
                
                toDownload.push(missing);
            }

            if (toDownload.length === 0) {
                this.showNotification('No models available for download (all have local matches or no download URLs).', 'info');
                return;
            }

            // Start all downloads
            this.showNotification(`Starting ${toDownload.length} download${toDownload.length > 1 ? 's' : ''}...`, 'info');
            
            for (const missing of toDownload) {
                // Use downloadModel which handles progress tracking
                this.downloadModel(missing);
            }
            
            // Update button state to show Cancel All
            this.updateDownloadAllButtonState();

        } catch (error) {
            console.error('Model Linker: Error in downloadAllMissing:', error);
            this.showNotification('Error starting downloads: ' + error.message, 'error');
        }
    }

    /**
     * Auto-resolve a model after download completes
     * Reloads the workflow analysis and resolves if the downloaded model is found
     */
    async autoResolveAfterDownload(missing, downloadedFilename) {
        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                // Just reload the UI to show updated state
                await this.loadWorkflowData();
                return;
            }

            // Re-analyze workflow to find the newly downloaded model
            const analyzeResponse = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!analyzeResponse.ok) {
                // Just reload UI
                await this.loadWorkflowData();
                return;
            }

            const analyzeData = await analyzeResponse.json();
            const missingModels = analyzeData.missing_models || [];

            // Find the missing model entry that matches our download by filename
            const targetMissing = missingModels.find(m => {
                const missingFilename = m.original_path?.split('/').pop()?.split('\\').pop() || '';
                return missingFilename.toLowerCase() === downloadedFilename.toLowerCase();
            });

            if (!targetMissing) {
                // Model no longer missing - already resolved or workflow changed
                await this.loadWorkflowData();
                return;
            }

            // Look for a 100% match with the downloaded filename
            const matches = targetMissing.matches || [];
            const perfectMatch = matches.find(m => {
                const matchFilename = m.filename || m.model?.filename || '';
                // Check for exact match or 100% confidence
                return m.confidence === 100 || 
                       matchFilename.toLowerCase() === downloadedFilename.toLowerCase();
            });

            if (perfectMatch && perfectMatch.model) {
                // Auto-resolve ALL nodes that need this model
                // all_node_refs contains all nodes referencing this model (deduplicated)
                const nodeRefs = targetMissing.all_node_refs || [targetMissing];
                const resolutions = nodeRefs.map(ref => ({
                    node_id: ref.node_id,
                    widget_index: ref.widget_index,
                    resolved_path: perfectMatch.model.path,
                    category: ref.category,
                    resolved_model: perfectMatch.model,
                    subgraph_id: ref.subgraph_id,
                    is_top_level: ref.is_top_level
                }));

                const resolveResponse = await api.fetchApi('/model_linker/resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workflow,
                        resolutions: resolutions
                    })
                });

                if (resolveResponse.ok) {
                    const resolveData = await resolveResponse.json();
                    if (resolveData.success) {
                        await this.updateWorkflowInComfyUI(resolveData.workflow);
                        const count = resolutions.length;
                        this.showNotification(`✓ Auto-resolved: ${downloadedFilename} (${count} reference${count > 1 ? 's' : ''})`, 'success');
                        await this.loadWorkflowData(resolveData.workflow);
                        return;
                    }
                }
            }

            // If we couldn't auto-resolve, just reload the UI
            await this.loadWorkflowData();

        } catch (error) {
            console.error('Model Linker: Error auto-resolving after download:', error);
            // Still reload UI even on error
            await this.loadWorkflowData();
        }
    }

    /**
     * Download a model from a known source
     */
    async downloadModel(missing) {
        const source = missing.download_source;
        if (!source || !source.url) {
            this.showNotification('No download URL available', 'error');
            return;
        }

        // Use filename from download source if available (may be different from original)
        const originalFilename = missing.original_path?.split('/').pop()?.split('\\').pop() || 'model.safetensors';
        const filename = source.filename || originalFilename;
        const category = source.directory || missing.category || 'checkpoints';
        const progressId = `download-progress-${missing.node_id}-${missing.widget_index}`;
        const progressDiv = this.contentElement?.querySelector(`#${progressId}`);
        const downloadBtn = this.contentElement?.querySelector(`#download-${missing.node_id}-${missing.widget_index}`);

        try {
            // Disable button and show progress with cancel button immediately
            if (downloadBtn) {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Starting...';
            }
            if (progressDiv) {
                progressDiv.style.display = 'block';
                // Show progress bar with cancel button immediately
                progressDiv.innerHTML = `
                    <div class="ml-progress-container">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="ml-progress-bar" style="flex: 1;">
                                <div class="ml-progress-fill" style="width: 0%;"></div>
                            </div>
                            <button class="cancel-download-btn-pending ml-btn ml-btn-danger ml-btn-sm">
                                Cancel
                            </button>
                        </div>
                        <div class="ml-progress-text">
                            <span style="color: #2196F3;">Connecting...</span>
                        </div>
                    </div>
                `;
            }

            // Start download
            const response = await api.fetchApi('/model_linker/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: source.url,
                    filename: filename,
                    category: category
                })
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Download failed');
            }

            // Track download and poll for progress
            const downloadId = data.download_id;
            this.activeDownloads[downloadId] = { missing, progressDiv, downloadBtn };
            
            // Update the Download All button state
            this.updateDownloadAllButtonState();
            
            // Attach cancel handler to pending button (before polling replaces it)
            const pendingCancelBtn = progressDiv?.querySelector('.cancel-download-btn-pending');
            if (pendingCancelBtn) {
                pendingCancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
            }
            
            this.pollDownloadProgress(downloadId);

        } catch (error) {
            console.error('Model Linker: Download error:', error);
            if (progressDiv) {
                progressDiv.innerHTML = this.renderStatusMessage(error.message, 'error');
            }
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<span class="ml-btn-icon">☁</span> Retry';
            }
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    /**
     * Poll download progress
     */
    async pollDownloadProgress(downloadId) {
        const info = this.activeDownloads[downloadId];
        if (!info) return;

        try {
            const response = await api.fetchApi(`/model_linker/progress/${downloadId}`);
            if (!response.ok) {
                throw new Error('Failed to get progress');
            }

            const progress = await response.json();
            const { progressDiv, downloadBtn, missing } = info;

            if (progress.status === 'downloading' || progress.status === 'starting') {
                const percent = progress.progress || 0;
                const downloaded = this.formatBytes(progress.downloaded || 0);
                const total = this.formatBytes(progress.total_size || 0);
                const speed = progress.speed ? this.formatBytes(progress.speed) + '/s' : '';
                
                if (progressDiv) {
                    progressDiv.innerHTML = `
                        <div class="ml-progress-container">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div class="ml-progress-bar" style="flex: 1;">
                                    <div class="ml-progress-fill" style="width: ${percent}%;"></div>
                                </div>
                                <button class="cancel-download-btn ml-btn ml-btn-danger ml-btn-sm" data-download-id="${downloadId}">
                                    Cancel
                                </button>
                            </div>
                            <div class="ml-progress-text">
                                <span>${downloaded} / ${total} (${percent}%)</span>
                                <span>${speed}</span>
                            </div>
                        </div>
                    `;
                    // Attach cancel handler
                    const cancelBtn = progressDiv.querySelector('.cancel-download-btn');
                    if (cancelBtn && !cancelBtn._hasListener) {
                        cancelBtn._hasListener = true;
                        cancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
                    }
                }
                if (downloadBtn) {
                    downloadBtn.textContent = `${percent}%`;
                }

                // Continue polling
                setTimeout(() => this.pollDownloadProgress(downloadId), 1000);

            } else if (progress.status === 'completed') {
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage('Download complete! Auto-linking...', 'success');
                }
                if (downloadBtn) {
                    downloadBtn.textContent = '✓ Done';
                    downloadBtn.classList.add('ml-btn-primary');
                }
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.showNotification(`Downloaded: ${progress.filename}`, 'success');
                
                // Auto-resolve: Reload workflow data and try to resolve the downloaded model
                // Small delay to ensure file system is updated
                setTimeout(async () => {
                    await this.autoResolveAfterDownload(missing, progress.filename);
                }, 500);

            } else if (progress.status === 'error') {
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage(progress.error || 'Download failed', 'error');
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = 'Retry';
                }
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();

            } else if (progress.status === 'cancelled') {
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage('Download cancelled - incomplete file removed', 'warning');
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = '<span class="ml-btn-icon">☁</span> Download';
                }
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.showNotification('Download cancelled', 'info');

            } else {
                // Unknown status, keep polling
                setTimeout(() => this.pollDownloadProgress(downloadId), 500);
            }

        } catch (error) {
            console.error('Model Linker: Progress poll error:', error);
            const info = this.activeDownloads[downloadId];
            // Update UI to show error state instead of just disappearing
            if (info) {
                const { progressDiv, downloadBtn } = info;
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage('Connection lost - download may have failed', 'error');
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = 'Retry';
                    downloadBtn.style.background = '#4CAF50';
                }
            }
            delete this.activeDownloads[downloadId];
            this.updateDownloadAllButtonState();
        }
    }

    /**
     * Cancel an active download
     */
    async cancelDownload(downloadId) {
        try {
            const response = await api.fetchApi(`/model_linker/cancel/${downloadId}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to cancel download');
            }
            
            const info = this.activeDownloads[downloadId];
            if (info?.progressDiv) {
                info.progressDiv.innerHTML = this.renderStatusMessage('Cancelling download...', 'info');
            }
            
        } catch (error) {
            console.error('Model Linker: Cancel error:', error);
            this.showNotification('Failed to cancel download', 'error');
        }
    }

    /**
     * Search online for a model
     */
    async searchOnline(missing) {
        const filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        const category = missing.category || '';
        const resultsId = `search-results-${missing.node_id}-${missing.widget_index}`;
        const resultsDiv = this.contentElement?.querySelector(`#${resultsId}`);
        const searchBtn = this.contentElement?.querySelector(`#search-${missing.node_id}-${missing.widget_index}`);

        try {
            if (searchBtn) {
                searchBtn.disabled = true;
                searchBtn.textContent = '🔍 Searching...';
            }
            if (resultsDiv) {
                resultsDiv.style.display = 'block';
                resultsDiv.innerHTML = '<span style="color: #2196F3;">Searching HuggingFace and CivitAI...</span>';
            }

            const response = await api.fetchApi('/model_linker/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, category })
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();
            this.displaySearchResults(missing, data, resultsDiv);

        } catch (error) {
            console.error('Model Linker: Search error:', error);
            if (resultsDiv) {
                resultsDiv.innerHTML = this.renderStatusMessage(`Search failed: ${error.message}`, 'error');
            }
        } finally {
            if (searchBtn) {
                searchBtn.disabled = false;
                searchBtn.innerHTML = '<span class="ml-btn-icon">🔍</span> Search Again';
            }
        }
    }

    /**
     * Display search results
     */
    displaySearchResults(missing, data, container) {
        if (!container) return;

        const popular = data.popular;
        const modelListResult = data.model_list;
        const hfResult = data.huggingface?.[0];
        const civitaiResult = data.civitai?.[0];
        const hasResults = popular || modelListResult || hfResult || civitaiResult;

        if (!hasResults) {
            container.innerHTML = this.renderStatusMessage('No matches found online for this model.', 'warning');
            return;
        }

        let html = '<div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">';

        // Popular models result (highest priority)
        if (popular) {
            html += `<div class="ml-status ml-status-success" style="flex-direction: column; align-items: flex-start;">`;
            html += `<strong>Found in Popular Models</strong>`;
            html += `<div style="margin-top: 8px;">`;
            html += `<button class="search-download-btn ml-btn ml-btn-primary ml-btn-sm" data-url="${popular.url}" data-filename="${popular.filename || missing.original_path?.split('/').pop()?.split('\\').pop()}" data-category="${popular.directory || missing.category}">`;
            html += `<span class="ml-btn-icon">☁</span> Download`;
            html += `</button>`;
            html += `</div></div>`;
        }

        // Model list result (ComfyUI Manager database with fuzzy matching)
        if (modelListResult && modelListResult.url) {
            const confidence = modelListResult.confidence ? ` (${modelListResult.confidence}%)` : '';
            const matchType = modelListResult.match_type === 'exact' ? 'Exact match' : 'Similar model';
            const statusClass = modelListResult.match_type === 'exact' ? 'ml-status-success' : 'ml-status-info';
            
            html += `<div class="ml-status ${statusClass}" style="flex-direction: column; align-items: flex-start;">`;
            html += `<strong>${matchType} in Model Database${confidence}</strong>`;
            html += `<div style="margin-top: 4px; font-size: 12px;">`;
            html += `<span class="ml-chip">${modelListResult.filename}</span>`;
            if (modelListResult.name) {
                html += ` <span style="color: var(--ml-text-muted);">${modelListResult.name}</span>`;
            }
            if (modelListResult.size) {
                html += ` <span class="ml-download-size">[${modelListResult.size}]</span>`;
            }
            html += `</div>`;
            html += `<div style="margin-top: 8px;">`;
            html += `<button class="search-download-btn ml-btn ml-btn-primary ml-btn-sm" data-url="${modelListResult.url}" data-filename="${modelListResult.filename}" data-category="${modelListResult.directory || missing.category}">`;
            html += `<span class="ml-btn-icon">☁</span> Download`;
            html += `</button>`;
            html += `</div></div>`;
        }

        // HuggingFace result
        if (hfResult && hfResult.url) {
            const hfRepo = hfResult.repo_id || hfResult.repo || '';
            html += `<div class="ml-status ml-status-info" style="flex-direction: column; align-items: flex-start;">`;
            html += `<strong>Found on HuggingFace</strong>`;
            html += `<div style="margin-top: 4px; font-size: 12px;">`;
            html += `<span class="ml-chip">${hfResult.filename}</span> `;
            html += `<span style="color: var(--ml-text-muted);">${hfRepo}</span>`;
            html += `</div>`;
            html += `<div style="margin-top: 8px;">`;
            html += `<button class="search-download-btn ml-btn ml-btn-link ml-btn-sm" data-url="${hfResult.url}" data-filename="${hfResult.filename}" data-category="${missing.category}">`;
            html += `<span class="ml-btn-icon">☁</span> Download`;
            html += `</button>`;
            html += `</div></div>`;
        }

        // CivitAI result
        if (civitaiResult && civitaiResult.download_url) {
            html += `<div class="ml-status ml-status-warning" style="flex-direction: column; align-items: flex-start;">`;
            html += `<strong>Found on CivitAI</strong>`;
            html += `<div style="margin-top: 4px; font-size: 12px;">`;
            html += `<span class="ml-chip">${civitaiResult.filename || civitaiResult.name}</span> `;
            html += `<span style="color: var(--ml-text-muted);">${civitaiResult.type || civitaiResult.name}</span>`;
            html += `</div>`;
            html += `<div style="margin-top: 8px;">`;
            html += `<button class="search-download-btn ml-btn ml-btn-sm" style="background: #FF9800;" data-url="${civitaiResult.download_url}" data-filename="${civitaiResult.filename || civitaiResult.name + '.safetensors'}" data-category="${missing.category}">`;
            html += `<span class="ml-btn-icon">☁</span> Download`;
            html += `</button>`;
            html += `</div></div>`;
        }

        html += '</div>';
        container.innerHTML = html;

        // Attach download listeners
        const downloadBtns = container.querySelectorAll('.search-download-btn');
        downloadBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                const filename = btn.dataset.filename;
                const category = btn.dataset.category;
                this.downloadFromSearch(missing, url, filename, category, btn);
            });
        });
    }

    /**
     * Download from search results
     */
    async downloadFromSearch(missing, url, filename, category, btn) {
        const progressId = `download-progress-${missing.node_id}-${missing.widget_index}`;
        const progressDiv = this.contentElement?.querySelector(`#${progressId}`);

        try {
            btn.disabled = true;
            btn.textContent = 'Starting...';
            
            if (progressDiv) {
                progressDiv.style.display = 'block';
                // Show progress bar with cancel button immediately
                progressDiv.innerHTML = `
                    <div class="ml-progress-container">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="ml-progress-bar" style="flex: 1;">
                                <div class="ml-progress-fill" style="width: 0%;"></div>
                            </div>
                            <button class="cancel-download-btn-pending ml-btn ml-btn-danger ml-btn-sm">
                                Cancel
                            </button>
                        </div>
                        <div class="ml-progress-text">
                            <span style="color: #2196F3;">Connecting...</span>
                        </div>
                    </div>
                `;
            }

            const response = await api.fetchApi('/model_linker/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, filename, category })
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Download failed');
            }

            // Track and poll
            const downloadId = data.download_id;
            this.activeDownloads[downloadId] = { missing, progressDiv, downloadBtn: btn };
            
            // Update the Download All button state
            this.updateDownloadAllButtonState();
            
            // Attach cancel handler to pending button (before polling replaces it)
            const pendingCancelBtn = progressDiv?.querySelector('.cancel-download-btn-pending');
            if (pendingCancelBtn) {
                pendingCancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
            }
            
            this.pollDownloadProgress(downloadId);

        } catch (error) {
            console.error('Model Linker: Download error:', error);
            if (progressDiv) {
                progressDiv.innerHTML = this.renderStatusMessage(error.message, 'error');
            }
            btn.disabled = false;
            btn.textContent = 'Retry';
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Extract model card URL from a download URL
     * HuggingFace: https://huggingface.co/Owner/Repo/resolve/main/file.safetensors -> https://huggingface.co/Owner/Repo
     * CivitAI: https://civitai.com/api/download/models/123?type=Model -> https://civitai.com/models/123
     */
    getModelCardUrl(downloadUrl) {
        if (!downloadUrl) return null;
        
        try {
            // HuggingFace URLs
            if (downloadUrl.includes('huggingface.co')) {
                // Extract owner/repo from URL
                const match = downloadUrl.match(/huggingface\.co\/([^\/]+\/[^\/]+)/);
                if (match) {
                    return `https://huggingface.co/${match[1]}`;
                }
            }
            
            // CivitAI URLs
            if (downloadUrl.includes('civitai.com')) {
                // Format: /api/download/models/123456 or /models/123456/...
                const modelIdMatch = downloadUrl.match(/models\/(\d+)/);
                if (modelIdMatch) {
                    return `https://civitai.com/models/${modelIdMatch[1]}`;
                }
            }
        } catch (e) {
            console.error('Error parsing model card URL:', e);
        }
        
        return null;
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
        this.buttonGroup = null;
        this.buttonId = "model-linker-button";
        this.dialog = null;
        this.isCheckingMissing = false;  // Prevent multiple simultaneous checks
        this.lastCheckedWorkflow = null;  // Track to avoid duplicate checks
    }

    setup = async () => {
        // Remove any existing button
        this.removeExistingButton();

        // Create dialog instance
        if (!this.dialog) {
            this.dialog = new LinkerManagerDialog();
        }

        // Register keyboard shortcut (Ctrl+Shift+L)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                this.openLinkerManager();
            }
        });

        // Listen for workflow load events to auto-check for missing models
        this.setupAutoOpenOnMissingModels();

        // Try to use new ComfyUI button system (like ComfyUI Manager does)
        try {
            // Dynamic imports for ComfyUI's button components
            const { ComfyButtonGroup } = await import("../../../scripts/ui/components/buttonGroup.js");
            const { ComfyButton } = await import("../../../scripts/ui/components/button.js");

            // Create button group with Model Linker button
            this.buttonGroup = new ComfyButtonGroup(
                new ComfyButton({
                    icon: "link-variant",
                    action: () => this.openLinkerManager(),
                    tooltip: "Model Linker - Resolve missing models (Ctrl+Shift+L)",
                    content: "Model Linker",
                    classList: "comfyui-button comfyui-menu-mobile-collapse"
                }).element
            );

            // Insert before settings group in the menu
            app.menu?.settingsGroup.element.before(this.buttonGroup.element);
        } catch (e) {
            // Fallback for older ComfyUI versions without the new button system
            console.log('Model Linker: New button system not available, using floating button fallback.');
            this.createFloatingButton();
        }
    }

    /**
     * Setup auto-open functionality when workflow is loaded with missing models
     */
    setupAutoOpenOnMissingModels() {
        // Watch for ComfyUI's Missing Models popup and inject our button
        this.setupMissingModelsPopupObserver();

        console.log('Model Linker: Missing models popup button injection enabled');
    }

    /**
     * Setup MutationObserver to detect ComfyUI's Missing Models popup and inject our button
     */
    setupMissingModelsPopupObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.checkAndInjectButton(node);
                    }
                }
            }
        });

        // Observe the entire document for added nodes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Check if a node is the Missing Models popup and inject our buttons
     */
    checkAndInjectButton(node) {
        // Look for the Missing Models popup by finding elements with "Missing Models" text
        const findMissingModelsDialog = (element) => {
            // Check if this element or its children contain "Missing Models" heading
            const headings = element.querySelectorAll ? element.querySelectorAll('h2, h3, [class*="title"], [class*="header"]') : [];
            for (const heading of headings) {
                if (heading.textContent?.includes('Missing Models')) {
                    return element;
                }
            }
            // Also check text content directly
            if (element.textContent?.includes('Missing Models') && 
                element.textContent?.includes('following models were not found')) {
                return element;
            }
            return null;
        };

        const dialog = findMissingModelsDialog(node);
        if (!dialog) return;

        // Check if we already injected buttons
        if (dialog.querySelector('#model-linker-btn-container')) return;

        // Find a suitable place to inject the button
        const injectButtons = () => {
            // Common button style
            const btnStyle = `
                padding: 6px 12px;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                transition: all 0.2s ease;
                white-space: nowrap;
            `;

            // Auto-resolve button (green)
            const autoResolveBtn = document.createElement('button');
            autoResolveBtn.id = 'model-linker-btn-container'; // Use this ID to prevent duplicate injection
            autoResolveBtn.textContent = '🔗 Auto-resolve 100%';
            autoResolveBtn.title = 'Automatically link models with 100% confidence matches';
            autoResolveBtn.style.cssText = btnStyle + `background: #4CAF50;`;
            
            autoResolveBtn.addEventListener('mouseenter', () => {
                autoResolveBtn.style.background = '#45a049';
            });
            autoResolveBtn.addEventListener('mouseleave', () => {
                autoResolveBtn.style.background = '#4CAF50';
            });
            autoResolveBtn.addEventListener('click', async () => {
                await this.handleAutoResolveInPopup(dialog, autoResolveBtn);
            });

            // Find the "Don't show this again" checkbox row and add button next to it
            const checkbox = dialog.querySelector('input[type="checkbox"]');
            if (checkbox) {
                const checkboxRow = checkbox.closest('label') || checkbox.parentElement;
                if (checkboxRow && checkboxRow.parentElement) {
                    // Make the parent a flex container to align checkbox and button
                    checkboxRow.parentElement.style.cssText = `
                        display: flex;
                        align-items: center;
                        gap: 16px;
                        padding: 0 16px;
                        margin-bottom: 8px;
                    `;
                    // Insert button at the beginning (left side)
                    checkboxRow.parentElement.insertBefore(autoResolveBtn, checkboxRow);
                    return;
                }
            }

            // Fallback: Find the list of models and insert before it
            const modelList = dialog.querySelector('[style*="overflow"]') || 
                             dialog.querySelector('[class*="list"]') ||
                             dialog.querySelector('[class*="content"]');
            
            if (modelList) {
                // Create a wrapper and insert before the model list
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'display: flex; justify-content: flex-end; padding: 0 16px; margin-bottom: 8px;';
                wrapper.appendChild(autoResolveBtn);
                modelList.parentElement?.insertBefore(wrapper, modelList);
            } else {
                // Find after the description text
                const allElements = dialog.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.textContent?.includes('following models were not found') && 
                        el.children.length === 0) {
                        el.parentElement?.insertBefore(btnContainer, el.nextSibling);
                        break;
                    }
                }
            }
            
            console.log('Model Linker: Injected buttons into Missing Models popup');
        };

        // Small delay to ensure popup is fully rendered
        setTimeout(injectButtons, 100);
    }

    /**
     * Handle auto-resolve in the popup - resolve 100% matches and open Model Linker for remaining
     */
    async handleAutoResolveInPopup(dialog, button) {
        button.textContent = '⏳ Resolving...';
        button.disabled = true;

        // Close the popup first
        const closeBtn = dialog.querySelector('button[class*="close"]') || 
                        dialog.querySelector('svg')?.closest('button') ||
                        Array.from(dialog.querySelectorAll('button')).find(b => 
                            b.textContent === '×' || b.innerHTML.includes('×') || b.innerHTML.includes('close'));
        
        if (closeBtn) {
            closeBtn.click();
        }

        // Small delay to let popup close
        await new Promise(r => setTimeout(r, 200));

        // Create dialog if needed
        if (!this.dialog) {
            this.dialog = new LinkerManagerDialog();
        }

        // Run auto-resolve for 100% matches - returns the updated workflow
        const updatedWorkflow = await this.dialog.autoResolve100Percent();
        
        // Always open Model Linker to show remaining unresolved models
        // Pass the updated workflow if available to avoid race condition
        this.dialog.show(updatedWorkflow || null);
    }

    /**
     * Mark resolved model items in the popup as linked (green) and hide download buttons
     */
    removeResolvedFromPopup(dialog, resolvedFilenames) {
        console.log('Model Linker: Looking for resolved filenames:', resolvedFilenames);
        
        // Strategy: For each filename, find text nodes containing it, 
        // then find the nearest Download button and mark that row
        for (const filename of resolvedFilenames) {
            // Get all text in the dialog and find elements containing our filename
            const walker = document.createTreeWalker(
                dialog,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent?.toLowerCase().includes(filename)) {
                    // Found text containing filename - now find parent with Download button
                    let parent = node.parentElement;
                    let attempts = 0;
                    
                    while (parent && parent !== dialog && attempts < 10) {
                        // Look for Download button at this level
                        const downloadBtn = Array.from(parent.querySelectorAll('button'))
                            .find(btn => btn.textContent?.includes('Download') && 
                                        !btn.id?.includes('model-linker'));
                        
                        if (downloadBtn) {
                            console.log('Model Linker: Found entry for', filename);
                            this.markEntryAsResolved(parent, downloadBtn);
                            break;
                        }
                        
                        parent = parent.parentElement;
                        attempts++;
                    }
                    
                    // Only process first match for this filename
                    break;
                }
            }
        }
    }

    /**
     * Mark a model entry as resolved with visual feedback
     */
    markEntryAsResolved(container, downloadBtn) {
        // Already marked?
        if (container.dataset.resolved === 'true') return;
        container.dataset.resolved = 'true';
        
        console.log('Model Linker: Marking entry as resolved', container);
        
        // Add green background/styling to the container
        container.style.transition = 'all 0.3s ease';
        container.style.background = 'rgba(76, 175, 80, 0.2)';
        container.style.borderRadius = '6px';
        container.style.border = '1px solid #4CAF50';
        
        // Hide the Download button and replace with badge
        if (downloadBtn) {
            // Create badge
            const badge = document.createElement('span');
            badge.textContent = '✓ Linked';
            badge.style.cssText = `
                display: inline-flex;
                align-items: center;
                padding: 4px 12px;
                background: #4CAF50;
                color: white;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
            `;
            
            // Replace download button with badge
            downloadBtn.style.display = 'none';
            downloadBtn.parentElement?.insertBefore(badge, downloadBtn);
        }
        
        // Find and hide Copy URL button
        const allBtns = container.querySelectorAll('button');
        for (const btn of allBtns) {
            if (btn.textContent?.includes('Copy URL')) {
                btn.style.display = 'none';
            }
        }
    }

    /**
     * Count remaining model items in the popup
     */
    countRemainingItems(dialog) {
        // Count elements that look like model entries (have Download buttons)
        const downloadButtons = dialog.querySelectorAll('button');
        let count = 0;
        for (const btn of downloadButtons) {
            if (btn.textContent?.includes('Download') && !btn.id?.includes('model-linker')) {
                count++;
            }
        }
        return count;
    }

    /**
     * Update nodes directly in the graph without triggering a full workflow reload
     * This prevents the Missing Models popup from closing
     */
    updateNodesDirectly(resolutions) {
        if (!app?.graph) {
            console.warn('Model Linker: Cannot update nodes - graph not available');
            return;
        }

        for (const resolution of resolutions) {
            const nodeId = resolution.node_id;
            const widgetIndex = resolution.widget_index;
            const resolvedPath = resolution.resolved_path;

            // Find the node in the graph
            const node = app.graph.getNodeById(nodeId);
            if (!node) {
                console.warn(`Model Linker: Node ${nodeId} not found in graph`);
                continue;
            }

            // Update the widget value
            if (node.widgets && node.widgets[widgetIndex]) {
                const widget = node.widgets[widgetIndex];
                widget.value = resolvedPath;
                
                // Trigger widget callback if it exists
                if (widget.callback) {
                    widget.callback(resolvedPath, app.graph, node, null, null);
                }
                
                console.log(`Model Linker: Updated node ${nodeId} widget ${widgetIndex} to ${resolvedPath}`);
            } else if (node.widgets_values) {
                // Fallback: update widgets_values array directly
                node.widgets_values[widgetIndex] = resolvedPath;
                console.log(`Model Linker: Updated node ${nodeId} widgets_values[${widgetIndex}] to ${resolvedPath}`);
            }

            // Mark node as dirty to trigger redraw
            if (node.setDirtyCanvas) {
                node.setDirtyCanvas(true, true);
            }
        }

        // Trigger canvas redraw
        if (app.graph.setDirtyCanvas) {
            app.graph.setDirtyCanvas(true, true);
        }
    }

    /**
     * Check if auto-open is enabled in user settings
     */
    isAutoOpenEnabled() {
        return localStorage.getItem('modelLinker.autoOpenOnMissing') !== 'false';
    }

    /**
     * Set auto-open preference
     */
    setAutoOpenEnabled(enabled) {
        localStorage.setItem('modelLinker.autoOpenOnMissing', enabled ? 'true' : 'false');
    }

    /**
     * Check for missing models and auto-open dialog if any are found
     */
    async checkAndOpenForMissingModels() {
        // Check if auto-open is enabled
        if (!this.isAutoOpenEnabled()) {
            return;
        }

        // Prevent multiple simultaneous checks
        if (this.isCheckingMissing) {
            return;
        }

        this.isCheckingMissing = true;

        try {
            // Small delay to let workflow fully load
            await new Promise(r => setTimeout(r, 500));

            // Get current workflow
            const workflow = app?.graph?.serialize();
            if (!workflow) {
                return;
            }

            // Create a simple hash to detect if workflow changed
            const workflowHash = JSON.stringify(workflow.nodes?.map(n => n.type + ':' + JSON.stringify(n.widgets_values || [])));
            
            // Skip if we already checked this exact workflow
            if (this.lastCheckedWorkflow === workflowHash) {
                return;
            }
            this.lastCheckedWorkflow = workflowHash;

            // Call analyze endpoint to check for missing models
            const response = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!response.ok) {
                console.warn('Model Linker: Failed to analyze workflow for missing models');
                return;
            }

            const data = await response.json();
            
            // Auto-open dialog if there are missing models
            if (data.total_missing > 0) {
                console.log(`Model Linker: Found ${data.total_missing} missing model(s), opening dialog...`);
                this.openLinkerManager();
            }

        } catch (error) {
            console.error('Model Linker: Error checking for missing models:', error);
        } finally {
            this.isCheckingMissing = false;
        }
    }

    removeExistingButton() {
        // Remove any existing button by ID
        const existingButton = document.getElementById(this.buttonId);
        if (existingButton) {
            existingButton.remove();
        }

        // Remove button group if it exists
        if (this.buttonGroup?.element?.parentNode) {
            this.buttonGroup.element.remove();
            this.buttonGroup = null;
        }

        // Also remove the stored reference if it exists
        if (this.linkerButton && this.linkerButton.parentNode) {
            this.linkerButton.remove();
            this.linkerButton = null;
        }
    }

    createFloatingButton() {
        // Create a floating button as fallback for legacy ComfyUI versions
        this.linkerButton = $el("button", {
            id: this.buttonId,
            textContent: "🔗 Model Linker",
            title: "Open Model Linker to resolve missing models (Ctrl+Shift+L)",
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
    setup: modelLinker.setup
});

