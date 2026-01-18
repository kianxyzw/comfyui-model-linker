/**
 * ComfyUI Model Linker Extension - Frontend
 * 
 * Provides a menu button and dialog interface for relinking missing models in workflows.
 */

// Import ComfyUI APIs
// These paths are relative to the ComfyUI web directory
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el, ComfyDialog } from "../../scripts/ui.js";

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
        this.allModels = null; // list of all available models for dropdown
        this.pendingResolutions = [];
        this.pendingIndex = new Map(); // key -> index in pendingResolutions
        this.fullscreen = false;
        this._dragging = false;
        this._dragStart = null;

        // Create dialog element using $el
        this.element = $el("div.comfy-modal", {
            id: "model-linker-modal",
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
                flexDirection: "column",
                resize: "both",
                overflow: "hidden",
                minWidth: "640px",
                minHeight: "420px"
            }
        }, [
            this.createHeader(),
            this.createContent(),
            this.createFooter()
        ]);

        // Inject style to reduce button font-size by 2px within this modal
        try {
            if (!document.getElementById('model-linker-style-buttons')) {
                const style = $el("style", {
                    id: 'model-linker-style-buttons',
                    textContent: `
                        #model-linker-modal .model-linker-resolve-btn,
                        #model-linker-modal .comfy-button {
                            font-size: calc(1em - 2px);
                        }
                    `
                });
                document.head.appendChild(style);
            }
        } catch (e) { /* ignore */ }

        // Enforce modal layout to be vertical (column) regardless of ComfyUI updates
        // and make the model search input comfortably sized
        try {
            if (!document.getElementById('model-linker-style-layout')) {
                const layoutStyle = $el("style", {
                    id: 'model-linker-style-layout',
                    textContent: `
                        /* Force our modals to be column-oriented flex containers */
                        #model-linker-modal,
                        #manage-overrides-modal {
                            flex-direction: column !important;
                            align-items: stretch !important;
                            white-space: normal !important;
                        }

                        /* Ensure text wraps normally inside content */
                        #model-linker-content, #model-linker-content * { white-space: normal !important; }

                        /* Strongly enforce vertical stacking for the missing list */
                        #model-linker-modal #model-linker-content { display: block !important; }
                        #model-linker-modal #model-linker-missing-list {
                            display: flex !important;
                            flex-direction: column !important;
                            align-items: stretch !important;
                            gap: 16px !important;
                        }
                        #model-linker-modal #model-linker-missing-list > div {
                            display: block !important;
                        }
                        /* Make direct children inside each missing item stack vertically */
                        #model-linker-modal #model-linker-missing-list > div > div,
                        #model-linker-modal #model-linker-missing-list > div > p,
                        #model-linker-modal #model-linker-missing-list > div > ul,
                        #model-linker-modal #model-linker-missing-list > div > li {
                            display: block !important;
                            width: auto !important;
                        }

                        /* Stack each missing-model section vertically while keeping internal rows */
                        #model-linker-content div[id^="missing-"] {
                            display: flex !important;
                            flex-direction: column !important;
                            align-items: stretch !important;
                        }

                        /* Ensure the body/content area can actually grow */
                        #model-linker-modal #model-linker-body,
                        #manage-overrides-modal { min-height: 0 !important; }

                        /* Make the model search input readable and not tiny */
                        #model-linker-modal input[id^="combo-input-"] {
                            flex: 1 1 auto !important;
                            min-width: 240px !important;
                            padding: 6px 8px !important;
                            font-size: 13px !important;
                        }

                        /* Improve the dropdown list layering and sizing */
                        #model-linker-modal div[id^="combo-list-"] {
                            z-index: 100000 !important;
                            max-height: 320px !important;
                        }
                        /* Avoid wrapping inside dropdown labels when sizing */
                        #model-linker-modal div[id^="combo-list-"] code {
                            white-space: nowrap !important;
                        }
                    `
                });
                document.head.appendChild(layoutStyle);
            }
        } catch (e) { /* ignore */ }

        // Apply saved size if present and persist future resizes
        try {
            const saved = localStorage.getItem('model_linker_modal_size');
            if (saved) {
                const { w, h } = JSON.parse(saved);
                if (w && h) {
                    this.element.style.width = `${w}px`;
                    this.element.style.height = `${h}px`;
                }
            }
            // Restore last position if available
            const savedPos = localStorage.getItem('model_linker_modal_pos');
            if (savedPos) {
                const { top, left } = JSON.parse(savedPos);
                if (Number.isFinite(top) && Number.isFinite(left)) {
                    this.element.style.top = `${top}px`;
                    this.element.style.left = `${left}px`;
                    this.element.style.transform = 'none';
                }
            }
            // Observe size changes to persist
            if (window.ResizeObserver) {
                const ro = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        const rect = entry.target.getBoundingClientRect();
                        const w = Math.round(rect.width);
                        const h = Math.round(rect.height);
                        localStorage.setItem('model_linker_modal_size', JSON.stringify({ w, h }));
                    }
                });
                ro.observe(this.element);
                this._resizeObserver = ro;
            }
        } catch (e) {
            // ignore storage/observer errors
        }
    }

    createHeader() {
        const header = $el("div", {
            style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 20px 10px 20px",
                borderBottom: "1px solid var(--border-color)",
                backgroundColor: "var(--comfy-menu-bg, #202020)"
            }
        }, [
            $el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
                $el("div", {
                    id: "model-linker-drag-handle",
                    title: "Drag window",
                    ondragstart: (e) => e.preventDefault(),
                    style: {
                        cursor: "grab",
                        userSelect: "none",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        padding: "0 6px",
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: "0.9"
                    }
                }, [
                    $el("span", { textContent: "⠿" })
                ]),
                $el("h2", {
                    textContent: "🔗 Model Linker",
                    style: {
                        margin: "0",
                        color: "var(--input-text)",
                        fontSize: "18px",
                        fontWeight: "600"
                    }
                })
            ]),
            $el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
                $el("button", {
                    id: "model-linker-overrides-btn",
                    title: "Manage overrides",
                    textContent: "Overrides",
                    onclick: () => this.openOverridesManager(),
                    style: {
                        background: "none",
                        border: "1px solid var(--border-color)",
                        fontSize: "14px",
                        cursor: "pointer",
                        color: "var(--input-text)",
                        padding: "2px 8px",
                        height: "30px",
                        borderRadius: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }
                }),
                $el("button", {
                    id: "model-linker-fullscreen-toggle",
                    title: "Toggle full screen",
                    textContent: "⛶",
                    onclick: () => this.toggleFullScreen(),
                    style: {
                        background: "none",
                        border: "1px solid var(--border-color)",
                        fontSize: "16px",
                        cursor: "pointer",
                        color: "var(--input-text)",
                        padding: "2px 8px",
                        minWidth: "32px",
                        height: "30px",
                        borderRadius: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
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
            ])
        ]);
        // Double-click header to toggle full screen
        header.addEventListener('dblclick', () => this.toggleFullScreen());
        // Make only the drag handle draggable
        try {
            const handle = header.querySelector('#model-linker-drag-handle');
            if (handle) {
                const onMouseDown = (e) => {
                    if (this.fullscreen) return; // no drag in fullscreen
                    handle.style.cursor = 'grabbing';
                    this.startDrag(e);
                };
                const onMouseUpLocal = () => { handle.style.cursor = 'grab'; };
                handle.addEventListener('mousedown', onMouseDown);
                document.addEventListener('mouseup', onMouseUpLocal);
                this._dragHandleMouseDown = onMouseDown;
                this._dragHandleMouseUp = onMouseUpLocal;
            }
        } catch (e) { /* ignore */ }
        return header;
    }

    createContent() {
        // Wrap the body in a two-column layout: left = items, right = queued panel
        const body = $el("div", {
            id: "model-linker-body",
            style: {
                display: "flex",
                gap: "12px",
                padding: "16px",
                flex: "1",
                minHeight: "0",
                alignItems: "stretch",
                position: "relative"
            }
        });

        this.contentElement = $el("div", {
            id: "model-linker-content",
            style: {
                overflowY: "auto",
                flex: "1",
                minHeight: "0"
            }
        });

        this.queueElement = $el("div", {
            id: "model-linker-queue",
            style: {
                width: "320px",
                minWidth: "240px",
                maxWidth: "70%",
                borderLeft: "1px solid var(--border-color)",
                paddingLeft: "12px",
                display: "flex",
                flexDirection: "column"
            }
        }, [
            this.createQueuePanel()
        ]);

        // Splitter between content and queue
        this.splitterElement = $el("div", {
            id: "model-linker-splitter",
            title: "Drag to resize panels",
            style: {
                cursor: "col-resize",
                width: "6px",
                minWidth: "6px",
                background: "var(--border-color)",
                opacity: "0.4",
                borderRadius: "3px"
            },
            ondragstart: (e) => e.preventDefault()
        });

        body.appendChild(this.contentElement);
        body.appendChild(this.splitterElement);
        body.appendChild(this.queueElement);

        // Restore saved queue width and wire splitter
        try {
            const savedSplit = localStorage.getItem('model_linker_split_w');
            if (savedSplit) {
                const w = parseInt(savedSplit, 10);
                if (!isNaN(w) && w > 0) {
                    this.queueElement.style.width = `${w}px`;
                }
            }
        } catch (e) { }

        try {
            const onSplitMouseDown = (e) => this.startSplitDrag(e);
            this.splitterElement.addEventListener('mousedown', onSplitMouseDown);
            this._splitterMouseDown = onSplitMouseDown;
        } catch (e) { }
        // Toggle icon always visible
        try {
            this.queueToggleIcon = $el("button", {
                id: "queue-toggle-icon",
                title: "Collapse queue",
                onclick: () => this.toggleQueueCollapsed(),
                style: {
                    position: "absolute",
                    top: "50%",
                    right: "6px",
                    transform: "translateY(-50%)",
                    zIndex: "1000",
                    padding: "2px 6px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    background: "var(--comfy-input-bg, #2f2f2f)",
                    cursor: "pointer",
                    opacity: "0.9"
                }
            }, [document.createTextNode('⮜')]);
            body.appendChild(this.queueToggleIcon);
            this.updateQueueToggleIcon();
        } catch (e) { }
        // Restore queue collapsed state
        try {
            const col = localStorage.getItem('model_linker_queue_collapsed');
            if (col === '1') this.setQueueCollapsed(true);
        } catch (e) { }
        return body;
    }

    openOverridesManager() {
        try {
            if (!this.overridesDialog) this.overridesDialog = new ManageOverridesDialog();
            this.overridesDialog.show();
        } catch (e) {
            console.error('Model Linker: failed to open overrides dialog', e);
        }
    }

    createQueuePanel() {
        // Header row with title and clear button
        this.queueHeader = $el("div", {
            style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px"
            }
        }, [
            $el("div", { id: "queue-title", textContent: "Queued Selections (0)", style: { fontWeight: "600" } }),
            $el("div", { style: { display: "flex", gap: "6px" } }, [
                $el("button", {
                    id: "queue-toggle",
                    className: "model-linker-resolve-btn",
                    textContent: "Collapse",
                    onclick: () => this.toggleQueueCollapsed(),
                    style: { padding: "4px 8px" }
                }),
                $el("button", {
                    id: "queue-clear",
                    className: "model-linker-resolve-btn",
                    textContent: "Clear All",
                    onclick: () => this.clearAllQueued(),
                    style: { padding: "4px 8px" }
                })
            ])
        ]);

        // Scrollable list
        this.queueList = $el("div", {
            id: "queue-list",
            style: {
                overflowY: "auto",
                flex: "1",
                minHeight: "0",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                padding: "8px",
                background: "var(--comfy-input-bg, #2f2f2f)"
            }
        });

        const panel = $el("div", { style: { display: "flex", flexDirection: "column", minHeight: "0", flex: "1 1 auto" } }, [this.queueHeader, this.queueList]);
        return panel;
    }

    updateQueuePanel() {
        if (!this.queueList || !this.queueHeader) return;
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        // Update title count
        const title = this.queueHeader.querySelector('#queue-title');
        if (title) title.textContent = `Queued Selections (${list.length})`;
        const toggleBtn = this.queueHeader.querySelector('#queue-toggle');
        if (toggleBtn) toggleBtn.textContent = this.queueCollapsed ? 'Expand' : 'Collapse';

        if (!list.length) {
            this.queueList.innerHTML = '<div style="opacity:0.7;">No selections queued.</div>';
            return;
        }

        let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const label = (r.resolved_model?.relative_path || r.resolved_model?.filename || r.resolved_path || '').toString();
            const nodeLabel = r.node_label || r.node_type || (r.subgraph_id ? 'Subgraph' : 'Node');
            const orig = (r.original_path || '').toString();
            const rmId = `queue-remove-${i}`;
            html += `<div style="border:1px solid var(--border-color); border-radius:4px; padding:6px; background: rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:600;">${nodeLabel} #${r.node_id}</div>`;
            html += `<div style="font-size:12px; opacity:0.9;">Original: <code>${orig}</code></div>`;
            html += `<div style="font-size:12px;">Selected: <code>${label}</code></div>`;
            html += `<div style="margin-top:6px;"><button id="${rmId}" class="model-linker-resolve-btn" style="padding:2px 8px;">Remove</button></div>`;

        }
        html += '</div>';
        this.queueList.innerHTML = html;

        // Wire remove buttons
        for (let i = 0; i < list.length; i++) {
            const rmId = `queue-remove-${i}`;
            const btn = this.queueList.querySelector(`#${rmId}`);
            if (btn) {
                btn.addEventListener('click', () => this.removeQueuedByIndex(i));
            }
        }
    }

    // Remove queued by index (from right panel)
    removeQueuedByIndex(i) {
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        if (i < 0 || i >= list.length) return;
        const r = list[i];
        // Remove
        this.pendingResolutions.splice(i, 1);
        this.rebuildPendingIndex();
        // Update per-item selected bar
        const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };
        this.updateSelectedBarForMissing(m);
        this.updateApplyPendingButton();
        this.updateQueuePanel();
    }

    // Clear all queued selections and hide per-item selected bars
    clearAllQueued() {
        this.pendingResolutions = [];
        this.pendingIndex = new Map();
        this.updateApplyPendingButton();
        this.updateQueuePanel();
        try {
            document.querySelectorAll('.model-linker-selected').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
        } catch (e) { /* ignore */ }
    }

    // Collapse/expand queue panel and hide/show splitter
    toggleQueueCollapsed() {
        this.setQueueCollapsed(!this.queueCollapsed);
    }

    setQueueCollapsed(collapsed) {
        this.queueCollapsed = !!collapsed;
        if (!this.queueElement || !this.splitterElement) return;
        if (this.queueCollapsed) {
            this.queueElement.style.display = 'none';
            this.splitterElement.style.display = 'none';
            try { localStorage.setItem('model_linker_queue_collapsed', '1'); } catch (e) { }
        } else {
            this.queueElement.style.display = '';
            this.splitterElement.style.display = '';
            try { localStorage.setItem('model_linker_queue_collapsed', '0'); } catch (e) { }
        }
        this.updateQueuePanel();
        this.updateQueueToggleIcon();
    }

    updateQueueToggleIcon() {
        if (!this.queueToggleIcon) return;
        if (this.queueCollapsed) {
            this.queueToggleIcon.textContent = '⮞';
            this.queueToggleIcon.title = 'Expand queue';
            // keep at far right; nothing else to change
        } else {
            this.queueToggleIcon.textContent = '⮜';
            this.queueToggleIcon.title = 'Collapse queue';
        }
    }

    createFooter() {
        // Create buttons container
        const footer = $el("div", {
            style: {
                padding: "16px",
                borderTop: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px"
            }
        });

        // Auto resolve 100%
        const autoBtn = $el("button", {
            textContent: "Auto-Resolve 100% Matches",
            onclick: () => this.autoResolve100Percent(),
            className: "comfy-button",
            style: {
                padding: "8px 16px"
            }
        });

        // Apply pending resolutions
        this.applyPendingBtn = $el("button", {
            id: "apply-pending-resolutions",
            textContent: "Apply Selected (0)",
            className: "comfy-button model-linker-resolve-btn",
            onclick: () => this.applyPendingResolutions(),
            style: {
                padding: "8px 16px"
            }
        });

        footer.appendChild(this.applyPendingBtn);
        footer.appendChild(autoBtn);
        return footer;
    }

    async show() {
        this.element.style.display = "flex";
        await this.ensureAllModelsLoaded();
        await this.loadWorkflowData();
        try {
            const fs = localStorage.getItem('model_linker_modal_fullscreen');
            if (fs === '1') this.setFullScreen(true);
        } catch (e) { }
    }

    close() {
        this.element.style.display = "none";
    }

    /**
     * Ensure all models are loaded for the dropdown.
     */
    async ensureAllModelsLoaded() {
        if (this.allModels && this.allModels.length) return;
        try {
            const resp = await api.fetchApi('/model_linker/models');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const models = await resp.json();
            const list = Array.isArray(models) ? models : [];
            // Build labels and sort alphabetically
            this.allModels = list.map((m) => ({
                ...m,
                __label: `${m.category ? m.category + ': ' : ''}${m.relative_path || m.filename || ''}`
            })).sort((a, b) => (a.__label || '').localeCompare(b.__label || ''));
        } catch (e) {
            console.warn('Model Linker: could not load all models', e);
            this.allModels = [];
        }
    }

    /**
     * Simple debounce helper: returns a function that waits for `wait` ms after
     * the last call before invoking `callback`.
     */
    debounce(callback, wait = 250) {
        let t = null;
        return (...args) => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                callback.apply(this, args);
            }, wait);
        };
    }

    // Begin window drag
    startDrag(e) {
        try {
            const el = this.element;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            // Switch to absolute top/left (no transform) before dragging
            el.style.top = `${rect.top}px`;
            el.style.left = `${rect.left}px`;
            el.style.transform = 'none';
            this._dragging = true;
            this._dragStart = {
                x: e.clientX,
                y: e.clientY,
                top: rect.top,
                left: rect.left
            };
            // Prevent text selection while dragging
            this._prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            // Attach listeners
            this._onMouseMove = (ev) => this.onDrag(ev);
            this._onMouseUp = () => this.endDrag();
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp, { once: true });
        } catch (err) { /* ignore */ }
    }

    onDrag(e) {
        if (!this._dragging || !this._dragStart) return;
        const el = this.element;
        if (!el) return;
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        let top = this._dragStart.top + dy;
        let left = this._dragStart.left + dx;
        // Clamp to viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const pad = 4; // small padding
        left = Math.max(-w + pad, Math.min(vw - pad, left));
        top = Math.max(-h + pad, Math.min(vh - pad, top));
        el.style.top = `${Math.round(top)}px`;
        el.style.left = `${Math.round(left)}px`;
    }

    endDrag() {
        if (!this._dragging) return;
        this._dragging = false;
        document.removeEventListener('mousemove', this._onMouseMove);
        // Persist position
        try {
            const el = this.element;
            const rect = el.getBoundingClientRect();
            localStorage.setItem('model_linker_modal_pos', JSON.stringify({ top: Math.round(rect.top), left: Math.round(rect.left) }));
        } catch (e) { /* ignore */ }
        // Restore selection
        try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
    }

    // Begin split drag for resizable panels
    startSplitDrag(e) {
        try {
            if (!this.queueElement) return;
            const rect = this.queueElement.getBoundingClientRect();
            const body = document.getElementById('model-linker-body');
            const bodyRect = body ? body.getBoundingClientRect() : { width: window.innerWidth };
            this._splitDragging = true;
            this._splitStart = {
                x: e.clientX,
                startWidth: rect.width,
                containerWidth: bodyRect.width
            };
            this._prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            this._onSplitMove = (ev) => this.onSplitDrag(ev);
            this._onSplitUp = () => this.endSplitDrag();
            document.addEventListener('mousemove', this._onSplitMove);
            document.addEventListener('mouseup', this._onSplitUp, { once: true });
        } catch (err) { /* ignore */ }
    }

    onSplitDrag(e) {
        if (!this._splitDragging || !this._splitStart || !this.queueElement) return;
        const dx = e.clientX - this._splitStart.x;
        // Dragging right (dx>0) should decrease right panel width; left increases
        let newW = this._splitStart.startWidth - dx;
        const minW = 240;
        const maxW = Math.max(minW, Math.floor(this._splitStart.containerWidth - 360));
        if (newW < minW) newW = minW;
        if (newW > maxW) newW = maxW;
        this.queueElement.style.width = `${Math.round(newW)}px`;
    }

    endSplitDrag() {
        if (!this._splitDragging) return;
        this._splitDragging = false;
        document.removeEventListener('mousemove', this._onSplitMove);
        try {
            const rect = this.queueElement.getBoundingClientRect();
            localStorage.setItem('model_linker_split_w', String(Math.round(rect.width)));
        } catch (e) { }
        try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
    }

    // Toggle full screen mode for the dialog
    toggleFullScreen() {
        this.setFullScreen(!this.fullscreen);
    }

    setFullScreen(enable) {
        this.fullscreen = !!enable;
        const el = this.element;
        if (!el) return;
        const btn = document.getElementById('model-linker-fullscreen-toggle');
        if (enable) {
            // Save current size
            try {
                const rect = el.getBoundingClientRect();
                localStorage.setItem('model_linker_modal_size_before_fs', JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }));
            } catch (e) { }
            el.style.top = '0';
            el.style.left = '0';
            el.style.transform = 'none';
            el.style.width = '100vw';
            el.style.height = '100vh';
            el.style.maxWidth = '100vw';
            el.style.maxHeight = '100vh';
            el.style.borderRadius = '0';
            el.style.resize = 'none';
            if (btn) btn.textContent = '🗗';
            try { localStorage.setItem('model_linker_modal_fullscreen', '1'); } catch (e) { }
        } else {
            // Restore centered sizing
            el.style.maxWidth = '95vw';
            el.style.maxHeight = '95vh';
            el.style.borderRadius = '8px';
            el.style.resize = 'both';
            // Restore saved pre-FS size if available
            let wh = null;
            try { wh = JSON.parse(localStorage.getItem('model_linker_modal_size_before_fs') || 'null'); } catch (e) { }
            if (wh && wh.w && wh.h) {
                el.style.width = `${wh.w}px`;
                el.style.height = `${wh.h}px`;
            } else {
                el.style.width = '900px';
                el.style.height = '700px';
            }
            // Restore last known position if available, else center
            try {
                const pos = JSON.parse(localStorage.getItem('model_linker_modal_pos') || 'null');
                if (pos && Number.isFinite(pos.top) && Number.isFinite(pos.left)) {
                    el.style.top = `${pos.top}px`;
                    el.style.left = `${pos.left}px`;
                    el.style.transform = 'none';
                } else {
                    el.style.top = '50%';
                    el.style.left = '50%';
                    el.style.transform = 'translate(-50%, -50%)';
                }
            } catch (e) {
                el.style.top = '50%';
                el.style.left = '50%';
                el.style.transform = 'translate(-50%, -50%)';
            }
            if (btn) btn.textContent = '⛶';
            try { localStorage.setItem('model_linker_modal_fullscreen', '0'); } catch (e) { }
        }
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
        html += '<div id="model-linker-missing-list" style="display: flex; flex-direction: column; gap: 16px;">';

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
            const savedMatches = filteredMatches.filter(m => m.is_override);
            let matchesToShow = null;
            if (perfectMatches.length > 0) {
                // Show 100% matches, but always include saved matches as well
                const combined = [...perfectMatches];
                for (const sm of savedMatches) {
                    const p = sm.model?.path;
                    if (!combined.some(x => x.model?.path === p)) combined.push(sm);
                }
                matchesToShow = combined;
            } else {
                matchesToShow = otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
                // Ensure saved matches are included even if outside top 5
                for (const sm of savedMatches) {
                    const p = sm.model?.path;
                    if (!matchesToShow.some(x => x.model?.path === p)) matchesToShow.push(sm);
                }
            }

            // Sort: 100% matches first, then by confidence descending (same as renderMissingModel)
            const sortedMatches = matchesToShow.sort((a, b) => {
                if (a.confidence === 100 && b.confidence !== 100) return -1;
                if (a.confidence !== 100 && b.confidence === 100) return 1;
                return b.confidence - a.confidence;
            });

            // Attach listener for all displayed matches so the user can pick explicitly
            sortedMatches.forEach((match, matchIndex) => {
                const buttonId = `resolve-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
                const resolveButton = container.querySelector(`#${buttonId}`);
                if (resolveButton) {
                    resolveButton.addEventListener('click', () => {
                        this.queueResolution(missing, match.model);
                    });
                }
            });

            // Attach model combo picker (category-scoped)
            this.attachModelCombo(container, missing);
            // Refresh selected UI for this item based on queued selections
            this.updateSelectedBarForMissing(missing);

            // Wire Locate button (only available for top-level items)
            const locateId = `locate-${missing.node_id}-${missing.widget_index}`;
            const locateBtn = container.querySelector(`#${locateId}`);
            if (locateBtn && missing.is_top_level !== false) {
                locateBtn.addEventListener('click', () => this.locateNodeInGraph(missing.node_id));
            }

            // Model combo is already attached above
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

        let html = `<div id="missing-${missing.node_id}-${missing.widget_index}" style="border: 1px solid var(--border-color, #444); padding: 12px; border-radius: 4px; display:flex; flex-direction:column; align-items:stretch; gap:8px; white-space: normal;">`;

        // Display subgraph name as primary identifier if available, otherwise show node type
        // A node type that's a UUID indicates it's a subgraph instance
        const isSubgraphNode = missing.node_type && missing.node_type.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        const locateId = `locate-${missing.node_id}-${missing.widget_index}`;
        if (missing.subgraph_name) {
            // Show subgraph name as primary identifier
            html += `<div style="margin-bottom: 8px; display:flex; align-items:center; justify-content:space-between; gap:8px;">`;
            html += `<span><strong>Subgraph:</strong> ${missing.subgraph_name} (ID: ${missing.node_id})</span>`;
            if (missing.is_top_level === false) {
                html += `<button title="This node is inside a subgraph definition and can't be located in the main canvas" disabled class="model-linker-resolve-btn" style="opacity:.6; padding:2px 8px;">Located in subgraph</button>`;
            } else {
                html += `<button id="${locateId}" class="model-linker-resolve-btn" style="padding:2px 8px;">Locate</button>`;
            }
            html += `</div>`;
        } else if (isSubgraphNode) {
            // Node type is a UUID (subgraph) but we don't have the name (shouldn't happen, but handle gracefully)
            html += `<div style="margin-bottom: 8px; display:flex; align-items:center; justify-content:space-between; gap:8px;">`;
            html += `<span><strong>Node:</strong> <em>Subgraph</em> (ID: ${missing.node_id})</span>`;
            if (missing.is_top_level === false) {
                html += `<button title="This node is inside a subgraph definition and can't be located in the main canvas" disabled class="model-linker-resolve-btn" style="opacity:.6; padding:2px 8px;">Located in subgraph</button>`;
            } else {
                html += `<button id="${locateId}" class="model-linker-resolve-btn" style="padding:2px 8px;">Locate</button>`;
            }
            html += `</div>`;
        } else {
            // Regular node
            html += `<div style="margin-bottom: 8px; display:flex; align-items:center; justify-content:space-between; gap:8px;">`;
            html += `<span><strong>Node:</strong> ${missing.node_type} (ID: ${missing.node_id})</span>`;
            if (missing.is_top_level === false) {
                html += `<button title="This node is inside a subgraph definition and can't be located in the main canvas" disabled class="model-linker-resolve-btn" style="opacity:.6; padding:2px 8px;">Located in subgraph</button>`;
            } else {
                html += `<button id="${locateId}" class="model-linker-resolve-btn" style="padding:2px 8px;">Locate</button>`;
            }
            html += `</div>`;
        }
        html += `<div style="margin-bottom: 8px;"><strong>Missing Model:</strong> <code>${missing.original_path}</code></div>`;
        html += `<div style="margin-bottom: 8px;"><strong>Category:</strong> ${missing.category || 'unknown'}</div>`;
        // Selected state placeholder (filled dynamically when user queues a selection)
        const selectedId = `selected-${missing.node_id}-${missing.widget_index}-${missing.subgraph_id || 'top'}`;
        html += `<div id="${selectedId}" class="model-linker-selected" style="display:none; margin: 8px 0; padding: 8px; border: 1px solid var(--border-color, #444); border-radius: 4px; background: rgba(10,169,110,0.08);"></div>`;

        if (hasMatches) {
            // Filter out matches below 70% confidence threshold
            const filteredMatches = allMatches.filter(m => m.confidence >= 70);

            // Separate 100% matches from others (from filtered list)
            const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
            const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);

            // If we have 100% matches, show them AND always include saved matches as well.
            const savedMatches = filteredMatches.filter(m => m.is_override);
            let matchesToShow = null;
            if (perfectMatches.length > 0) {
                const combined = [...perfectMatches];
                for (const sm of savedMatches) {
                    const p = sm.model?.path;
                    if (!combined.some(x => x.model?.path === p)) combined.push(sm);
                }
                matchesToShow = combined;
            } else {
                matchesToShow = otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
                for (const sm of savedMatches) {
                    const p = sm.model?.path;
                    if (!matchesToShow.some(x => x.model?.path === p)) matchesToShow.push(sm);
                }
            }

            html += `<div style="margin-top: 12px;"><strong>Suggested Matches:</strong></div>`;
            html += '<ul style="margin: 8px 0; padding-left: 20px;">';

            // Sort: 100% matches first, then by confidence descending
            const sortedMatches = matchesToShow.sort((a, b) => {
                if (a.confidence === 100 && b.confidence !== 100) return -1;
                if (a.confidence !== 100 && b.confidence === 100) return 1;
                return b.confidence - a.confidence;
            });

            // Find the highest confidence match (even if not 100%)
            const highestConfidenceMatch = sortedMatches.length > 0 ? sortedMatches[0] : null;

            for (let matchIndex = 0; matchIndex < sortedMatches.length; matchIndex++) {
                const match = sortedMatches[matchIndex];
                const buttonId = `resolve-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
                html += `<li style="margin: 4px 0;">`;
                const label = match.model?.relative_path || match.filename;
                const isSaved = !!match.is_override;
                html += `<code>${label}</code> `;
                html += `<span style="color: ${match.confidence === 100 ? 'green' : 'orange'};">\n                    (${match.confidence}% confidence)\n                </span>`;
                if (isSaved) {
                    html += ` <span style="color:#0aa96e; font-weight:600;">(saved)</span>`;
                }
                // Always provide a Resolve button so the user can pick explicitly
                html += ` <button id="${buttonId}" 
                        class="model-linker-resolve-btn" style="margin-left: 8px; padding: 4px 8px;">
                        Select
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

        // Compact summary removed (duplicate of info shown above)

        // combo picker injected via attachModelCombo








        html += `</div>`;

        html += `</div>`;

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

    // Build a stable key for a missing entry (same as queueResolution)
    getResolutionKey(missing) {
        return `${missing.node_id}:${missing.widget_index}:${missing.subgraph_id || ''}:${missing.is_top_level ? 'T' : 'F'}`;
    }

    // Return queued resolution (if any) for a missing entry
    getQueuedResolutionForMissing(missing) {
        const key = this.getResolutionKey(missing);
        if (this.pendingIndex.has(key)) {
            const idx = this.pendingIndex.get(key);
            return this.pendingResolutions[idx];
        }
        return null;
    }

    // Rebuild index mapping after removals
    rebuildPendingIndex() {
        this.pendingIndex = new Map();
        for (let i = 0; i < this.pendingResolutions.length; i++) {
            const r = this.pendingResolutions[i];
            const k = `${r.node_id}:${r.widget_index}:${r.subgraph_id || ''}:${r.is_top_level ? 'T' : 'F'}`;
            this.pendingIndex.set(k, i);
        }
    }

    // Remove a queued resolution for a missing item
    removeQueuedResolution(missing) {
        const key = this.getResolutionKey(missing);
        if (!this.pendingIndex.has(key)) return;
        const idx = this.pendingIndex.get(key);
        this.pendingResolutions.splice(idx, 1);
        this.rebuildPendingIndex();
        this.updateSelectedBarForMissing(missing);
        this.updateApplyPendingButton();
        this.updateQueuePanel();
    }

    // Update the per-item selected UI area
    updateSelectedBarForMissing(missing) {
        const containerId = `selected-${missing.node_id}-${missing.widget_index}-${missing.subgraph_id || 'top'}`;
        const el = document.getElementById(containerId);
        if (!el) return;
        const queued = this.getQueuedResolutionForMissing(missing);
        if (!queued) {
            el.style.display = 'none';
            el.innerHTML = '';
            return;
        }
        const model = queued.resolved_model || {};
        const label = model.relative_path || model.filename || queued.resolved_path || 'selected model';
        const removeId = `selected-remove-${missing.node_id}-${missing.widget_index}-${missing.subgraph_id || 'top'}`;
        el.innerHTML = `<strong>Selected:</strong> <code>${label}</code> <button id="${removeId}" class="model-linker-resolve-btn" style="margin-left:8px; padding: 2px 8px;">Remove</button>`;
        el.style.display = '';
        const btn = document.getElementById(removeId);
        if (btn) {
            btn.onclick = () => this.removeQueuedResolution(missing);
        }
    }

    /**
     * Queue a single resolution (do not call backend yet)
     */
    queueResolution(missing, resolvedModel) {
        if (!resolvedModel) {
            this.showNotification('No model selected', 'error');
            return;
        }

        const resolution = {
            node_id: missing.node_id,
            widget_index: missing.widget_index,
            resolved_path: resolvedModel.path,
            category: missing.category,
            resolved_model: resolvedModel,
            original_path: missing.original_path,
            subgraph_id: missing.subgraph_id,
            is_top_level: missing.is_top_level,
            node_type: missing.node_type,
            node_label: missing.subgraph_name || missing.node_type
        };

        const key = `${resolution.node_id}:${resolution.widget_index}:${resolution.subgraph_id || ''}:${resolution.is_top_level ? 'T' : 'F'}`;
        if (this.pendingIndex.has(key)) {
            // replace existing selection for this slot
            const idx = this.pendingIndex.get(key);
            this.pendingResolutions[idx] = resolution;
        } else {
            this.pendingIndex.set(key, this.pendingResolutions.length);
            this.pendingResolutions.push(resolution);
        }

        // Update selected bar UI
        this.updateSelectedBarForMissing(missing);
        this.updateQueuePanel();
        this.updateApplyPendingButton();
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
                        original_path: missing.original_path,
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
     * Apply all queued resolutions in a single backend call
     */
    async applyPendingResolutions() {
        const list = this.pendingResolutions || [];
        if (!list.length) {
            this.showNotification('No selections queued', 'error');
            return;
        }

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            const response = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow, resolutions: list })
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();
            if (data.success) {
                await this.updateWorkflowInComfyUI(data.workflow);
                this.showNotification(`✓ Linked ${list.length} selection${list.length > 1 ? 's' : ''}`, 'success');
                // Clear queue and refresh analysis
                this.pendingResolutions = [];
                this.pendingIndex = new Map();
                this.updateApplyPendingButton();
                this.updateQueuePanel();
                await this.loadWorkflowData(data.workflow);
            } else {
                this.showNotification('Failed to apply selections: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            console.error('Model Linker: applyPendingResolutions error', e);
            this.showNotification('Error applying selections: ' + e.message, 'error');
        }
    }

    updateApplyPendingButton() {
        if (!this.applyPendingBtn) return;
        const n = (this.pendingResolutions || []).length;
        this.applyPendingBtn.textContent = `Apply Selected (${n})`;
        this.applyPendingBtn.disabled = n === 0;
        this.applyPendingBtn.style.opacity = n === 0 ? '0.6' : '1';
        // Keep the queue panel count in sync
        this.updateQueuePanel();
    }

    // Build and wire a node-like combo picker showing ALL models (not category-restricted)
    attachModelCombo(container, missing) {
        const category = null; // show all models regardless of category
        const inputId = `combo-input-${missing.node_id}-${missing.widget_index}`;
        const listId = `combo-list-${missing.node_id}-${missing.widget_index}`;
        const refreshId = `combo-refresh-${missing.node_id}-${missing.widget_index}`;

        // Inject combo markup after 'Selected' bar
        const selectedBar = container.querySelector(`#selected-${missing.node_id}-${missing.widget_index}-${missing.subgraph_id || 'top'}`);
        if (!selectedBar) return;
        const comboWrap = document.createElement('div');
        comboWrap.style.position = 'relative';
        comboWrap.style.margin = '8px 0';
        const catLabel = category ? ` (${category})` : '';
        comboWrap.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px;">
                <label style="opacity:0.9;">Model${catLabel}:</label>
                <input id="${inputId}" type="text" placeholder="type to filter..." style="flex:1; padding:4px;" />
                <button id="${refreshId}" title="Refresh model list" class="model-linker-resolve-btn" style="padding:2px 8px;">⟳</button>
            </div>
            <div id="${listId}" style="position:absolute; top:100%; left:0; background: var(--comfy-input-bg, #2f2f2f); border:1px solid var(--border-color); border-radius:4px; max-height:280px; overflow:auto; display:none; z-index:100000;"></div>
        `;
        selectedBar.after(comboWrap);

        const inputEl = comboWrap.querySelector(`#${inputId}`);
        const listEl = comboWrap.querySelector(`#${listId}`);
        const refreshBtn = comboWrap.querySelector(`#${refreshId}`);
        if (!inputEl || !listEl) return;

        const savedPaths = new Set((missing.matches || []).filter(m => m.is_override && m.model && m.model.path).map(m => m.model.path));
        const getPool = () => Array.isArray(this.allModels) ? this.allModels : [];

        const renderList = (items, query, activeIdx) => {
            if (!items || !items.length) {
                listEl.innerHTML = '<div style="padding:6px; opacity:0.8;">No results</div>';
                return;
            }
            const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
            const q = (query || '').toLowerCase();
            let html = '';
            for (let i = 0; i < items.length; i++) {
                const m = items[i];
                const labRaw = m.relative_path || m.filename || '';
                const isSaved = savedPaths.has(m.path);
                // highlight simple substring matches
                let labelHtml = esc(labRaw);
                if (q) {
                    const low = labRaw.toLowerCase();
                    let out = '';
                    let idx = 0;
                    for (; ;) {
                        const j = low.indexOf(q, idx);
                        if (j === -1) { out += esc(labRaw.slice(idx)); break; }
                        out += esc(labRaw.slice(idx, j)) + `<span style="font-weight:600; text-decoration:underline;">${esc(labRaw.slice(j, j + q.length))}</span>`;
                        idx = j + q.length;
                    }
                    labelHtml = out;
                }
                const activeStyle = (i === activeIdx) ? 'background: rgba(0,122,204,0.25);' : '';
                html += `<div data-idx="${i}" style="${activeStyle} padding:6px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                    <code style="flex:1;">${labelHtml}</code>
                    ${isSaved ? '<span style="color:#0aa96e; font-weight:600;">(saved)</span>' : ''}
                </div>`;
            }
            listEl.innerHTML = html;
        };

        const buildSuggestions = (query) => {
            const pool = getPool();
            const q = (query || '').toLowerCase();
            // Deduplicate by normalized label (relative_path || filename) to hide symlink duplicates
            const bestByKey = new Map();
            for (const m of pool) {
                const label = m.relative_path || m.filename || '';
                const labelNorm = (label || '').toLowerCase().replace(/[\\/]+/g, '/');
                if (q && !labelNorm.includes(q)) continue;
                const saved = savedPaths.has(m.path);
                const curr = bestByKey.get(labelNorm);
                // Prefer a saved entry if available; otherwise keep the first
                if (!curr || (saved && !curr.saved)) {
                    bestByKey.set(labelNorm, { m, label, saved });
                }
            }
            const items = Array.from(bestByKey.values());
            // sort: saved first, then label asc
            items.sort((a, b) => {
                if (a.saved && !b.saved) return -1;
                if (!a.saved && b.saved) return 1;
                return (a.label || '').localeCompare(b.label || '');
            });
            // return all deduplicated items so user can scroll entire list
            return items.map(x => x.m);
        };

        let currentItems = [];
        let activeIndex = -1;
        // Align dropdown under input and size to fit longest item (min: input width)
        const updateListPosition = () => {
            try {
                const wrapRect = comboWrap.getBoundingClientRect();
                const inputRect = inputEl.getBoundingClientRect();
                const left = Math.max(0, Math.round(inputRect.left - wrapRect.left));
                const minW = Math.round(inputRect.width);
                const prevDisplay = listEl.style.display;
                const prevVis = listEl.style.visibility;
                if (prevDisplay === 'none') {
                    listEl.style.visibility = 'hidden';
                    listEl.style.display = 'block';
                }
                const prevWidth = listEl.style.width;
                listEl.style.width = 'auto';
                // Prevent wrapping in labels when measuring
                try {
                    listEl.querySelectorAll('code').forEach(c => c.style.whiteSpace = 'nowrap');
                } catch (e) { }
                let contentW = Math.ceil(listEl.scrollWidth);
                const viewportRight = window.innerWidth - 16;
                const maxAllowed = Math.max(200, viewportRight - inputRect.left);
                const finalW = Math.max(minW, Math.min(contentW || minW, maxAllowed));
                listEl.style.left = left + 'px';
                listEl.style.right = 'auto';
                listEl.style.width = finalW + 'px';
                if (prevDisplay === 'none') {
                    listEl.style.display = prevDisplay;
                    listEl.style.visibility = prevVis || '';
                    listEl.style.width = prevWidth;
                }
            } catch (_) { }
        };
        const openList = () => { updateListPosition(); listEl.style.display = 'block'; };
        const closeList = () => { listEl.style.display = 'none'; activeIndex = -1; };
        const isOpen = () => listEl.style.display !== 'none';

        const updateList = () => {
            const q = inputEl.value || '';
            currentItems = buildSuggestions(q);
            if (currentItems.length && activeIndex < 0) activeIndex = 0;
            if (!currentItems.length) activeIndex = -1;
            renderList(currentItems, q, activeIndex);
            // Recompute width for new content
            updateListPosition();
        };

        inputEl.addEventListener('focus', () => { openList(); updateList(); });
        inputEl.addEventListener('input', this.debounce(() => { updateList(); openList(); }, 120));
        // Keep dropdown aligned on resize
        window.addEventListener('resize', updateListPosition);
        if (window.ResizeObserver) {
            try {
                const roPos = new ResizeObserver(() => updateListPosition());
                roPos.observe(comboWrap);
                roPos.observe(inputEl);
                this._comboROs = (this._comboROs || []).concat(roPos);
            } catch (e) { /* ignore */ }
        }
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeList(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!isOpen()) { openList(); updateList(); return; }
                if (!currentItems.length) return;
                activeIndex = Math.min(currentItems.length - 1, (activeIndex < 0 ? 0 : activeIndex + 1));
                renderList(currentItems, inputEl.value || '', activeIndex);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!isOpen()) { openList(); updateList(); return; }
                if (!currentItems.length) return;
                activeIndex = Math.max(0, (activeIndex < 0 ? 0 : activeIndex - 1));
                renderList(currentItems, inputEl.value || '', activeIndex);
                return;
            }
            if (e.key === 'Enter') {
                if (!isOpen()) return;
                if (activeIndex >= 0 && activeIndex < currentItems.length) {
                    const chosen = currentItems[activeIndex];
                    if (chosen) {
                        this.queueResolution(missing, chosen);
                        inputEl.value = chosen.relative_path || chosen.filename || '';
                        closeList();
                    }
                }
                return;
            }
        });
        listEl.addEventListener('mousedown', (e) => {
            const item = e.target.closest('[data-idx]');
            if (!item) return;
            const idx = parseInt(item.getAttribute('data-idx'), 10);
            const chosen = currentItems[idx];
            if (chosen) {
                this.queueResolution(missing, chosen);
                inputEl.value = chosen.relative_path || chosen.filename || '';
                closeList();
            }
        });
        document.addEventListener('click', (e) => {
            if (!comboWrap.contains(e.target)) closeList();
        });
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                try {
                    const resp = await api.fetchApi('/model_linker/models');
                    if (resp.ok) this.allModels = await resp.json();
                } catch (e) { }
                updateList(); openList();
            });
        }
    }

    // Center and select a node in the current graph by ID
    locateNodeInGraph(nodeId) {
        try {
            if (!app || !app.graph) {
                this.showNotification('Graph not available', 'error');
                return;
            }
            let node = null;
            if (typeof app.graph.getNodeById === 'function') {
                try { node = app.graph.getNodeById(nodeId); } catch (e) { /* ignore */ }
            }
            if (!node && app.graph._nodes_by_id) {
                node = app.graph._nodes_by_id[nodeId];
            }
            if (!node) {
                this.showNotification('Node not found in current view', 'error');
                return;
            }
            const canvas = app.canvas;
            if (canvas) {
                // Deselect other nodes
                if (typeof canvas.deselectAllNodes === 'function') {
                    try { canvas.deselectAllNodes(); } catch (e) { }
                }
                // Select this node
                if (typeof canvas.selectNode === 'function') {
                    try { canvas.selectNode(node, true); } catch (e) { }
                } else if (typeof canvas.selectNodes === 'function') {
                    try { canvas.selectNodes([node], true); } catch (e) { }
                }
                // Center on node
                if (typeof canvas.centerOnNode === 'function') {
                    try { canvas.centerOnNode(node); } catch (e) { }
                } else if (typeof canvas.scrollToCenter === 'function') {
                    try { canvas.scrollToCenter(); } catch (e) { }
                }
            }
        } catch (error) {
            console.error('Model Linker: locateNodeInGraph error', error);
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

class ManageOverridesDialog extends ComfyDialog {
    constructor() {
        super();
        this.data = null;
        this.search = '';
        this.element = $el("div.comfy-modal", {
            id: 'manage-overrides-modal',
            parent: document.body,
            style: {
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "720px",
                height: "520px",
                maxWidth: "95vw",
                maxHeight: "90vh",
                backgroundColor: "var(--comfy-menu-bg, #202020)",
                color: "var(--input-text, #ffffff)",
                border: "2px solid var(--border-color, #555555)",
                borderRadius: "8px",
                padding: "0",
                zIndex: "99999",
                boxShadow: "0 4px 20px rgba(0,0,0,0.8)",
                display: "none",
                flexDirection: "column",
                resize: "both",
                overflow: "hidden",
                minWidth: "560px",
                minHeight: "360px"
            }
        }, [
            this._header(),
            this._content(),
            this._footer()
        ]);

        // Persist window size for overrides dialog
        try {
            const saved = localStorage.getItem('model_linker_overrides_size');
            if (saved) {
                const { w, h } = JSON.parse(saved);
                if (w && h) { this.element.style.width = `${w}px`; this.element.style.height = `${h}px`; }
            }
            if (window.ResizeObserver) {
                const ro = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        const rect = entry.target.getBoundingClientRect();
                        localStorage.setItem('model_linker_overrides_size', JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }));
                    }
                });
                ro.observe(this.element);
                this._ro = ro;
            }
        } catch (e) { }

        // Scoped smaller button font-size (2px less) in overrides modal
        try {
            if (!document.getElementById('manage-overrides-style-buttons')) {
                const style = $el('style', {
                    id: 'manage-overrides-style-buttons', textContent: `
                    #manage-overrides-modal .model-linker-resolve-btn,
                    #manage-overrides-modal .comfy-button { font-size: calc(1em - 2px); }
                `});
                document.head.appendChild(style);
            }
        } catch (e) { }
    }

    _header() {
        return $el("div", {
            style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-color)"
            }
        }, [
            $el("h2", { textContent: "Manage Overrides", style: { margin: 0, fontSize: '16px' } }),
            $el("button", { textContent: "×", onclick: () => this.close(), style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--input-text)' } })
        ]);
    }

    _content() {
        this.contentEl = $el("div", {
            style: { padding: '12px', overflow: 'auto', flex: '1', minHeight: 0 }
        }, [
            $el("div", { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } }, [
                $el("input", {
                    id: 'ovr-search',
                    placeholder: 'search overrides...',
                    oninput: (e) => { this.search = e.target.value || ''; this.renderList(); },
                    style: { flex: 1, padding: '6px' }
                }),
                $el("span", { id: 'ovr-count', textContent: '' })
            ]),
            // Header row for two columns
            $el('div', { style: { display: 'flex', gap: '8px', padding: '6px 8px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, opacity: .9 } }, [
                $el('div', { style: { flex: '2 1 40%' }, textContent: 'Missing / Category' }),
                $el('div', { style: { flex: '3 1 55%' }, textContent: 'Override Path' }),
                $el('div', { style: { flex: '0 0 auto', width: '72px', textAlign: 'right' }, textContent: 'Actions' })
            ]),
            this.listEl = $el("div", { id: 'ovr-list', style: { display: 'flex', flexDirection: 'column', gap: '6px' } })
        ]);
        return this.contentEl;
    }

    _footer() {
        // Import
        const fileInput = $el('input', { type: 'file', accept: '.json', style: { display: 'none' } });
        const importBtn = $el('button', { className: 'model-linker-resolve-btn', textContent: 'Import JSON', onclick: () => fileInput.click(), style: { padding: '6px 10px' } });
        fileInput.addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            try {
                const text = await f.text();
                const json = JSON.parse(text);
                const resp = await api.fetchApi('/model_linker/overrides/replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides: json }) });
                const data = await resp.json();
                if (data.success) {
                    await this.load();
                } else {
                    alert('Import failed: ' + (data.error || 'unknown'));
                }
            } catch (err) {
                alert('Invalid JSON: ' + err.message);
            } finally {
                e.target.value = '';
            }
        });

        return $el("div", { style: { padding: '10px 12px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
            $el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
                $el('button', { className: 'model-linker-resolve-btn', textContent: 'Export JSON', onclick: () => this.export(), style: { padding: '6px 10px' } }),
                importBtn,
                fileInput
            ]),
            $el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
                $el('button', { className: 'model-linker-resolve-btn', textContent: 'Clear All', onclick: () => this.clearAll(), style: { padding: '6px 10px' } })
            ])
        ]);
    }

    async show() {
        this.element.style.display = 'flex';
        await this.load();
    }

    close() { this.element.style.display = 'none'; }

    async load() {
        try {
            const resp = await api.fetchApi('/model_linker/overrides');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            this.data = await resp.json();
            this.renderList();
        } catch (e) {
            console.error('Overrides load error', e);
            if (this.listEl) this.listEl.textContent = 'Error loading overrides';
        }
    }

    renderList() {
        if (!this.listEl) return;
        const mappings = (this.data && this.data.overrides && this.data.overrides.mappings) || [];
        const q = (this.search || '').toLowerCase();
        const filtered = mappings.filter(m => {
            const s = `${m.key || ''} ${m.original_filename || ''} ${m.category || ''} ${m.path || ''}`.toLowerCase();
            return !q || s.includes(q);
        });
        const countEl = this.contentEl && this.contentEl.querySelector('#ovr-count');
        if (countEl) countEl.textContent = `${filtered.length}/${mappings.length}`;
        if (!filtered.length) {
            this.listEl.innerHTML = '<div style="opacity:0.8; padding:8px;">No overrides</div>';
            return;
        }
        let html = '';
        for (const m of filtered) {
            const delId = `ovr-del-${m.key}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            html += `<div style="border:1px solid var(--border-color); border-radius:4px; padding:8px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="flex:1 1 auto; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><code title="${m.original_filename || ''}">${m.original_filename || ''}</code> <span style="opacity:.8;">[${m.category || 'any'}]</span></div>
                    <div style="flex:0 0 auto;"><button id="${delId}" class="model-linker-resolve-btn" style="padding:4px 8px;">Delete</button></div>
                </div>
                <div style="height:1px; background: var(--border-color); opacity:.5;"></div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><code title="${(m.path || '').split(/[\\/]/).pop() || ''}">${(m.path || '').split(/[\\/]/).pop() || ''}</code></div>
                    <div style="flex:0 0 auto;"><button id="ovr-pathbtn-${(m.key || '').replace(/[^a-zA-Z0-9_-]/g, '_')}" class="model-linker-resolve-btn" style="padding:4px 8px;">Path</button></div>
                </div>
                <div id="ovr-pathrow-${(m.key || '').replace(/[^a-zA-Z0-9_-]/g, '_')}" style="display:none; overflow-wrap:anywhere; opacity:.9;"><code title="${m.path || ''}">${m.path || ''}</code></div>
            </div>`;
        }
        this.listEl.innerHTML = html;
        // Wire delete and path toggle
        for (const m of filtered) {
            const safeKey = (m.key || '').replace(/[^a-zA-Z0-9_-]/g, '_');
            const delId = `ovr-del-${m.key}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const btn = this.listEl.querySelector(`#${delId}`);
            if (btn) {
                btn.addEventListener('click', async () => {
                    try {
                        const resp = await api.fetchApi('/model_linker/overrides/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: m.key }) });
                        const data = await resp.json();
                        if (data.success) await this.load(); else alert('Delete failed');
                    } catch (e) { alert('Delete failed: ' + e.message); }
                });
            }
            const pathBtn = this.listEl.querySelector(`#ovr-pathbtn-${safeKey}`);
            const pathRow = this.listEl.querySelector(`#ovr-pathrow-${safeKey}`);
            if (pathBtn && pathRow) {
                pathBtn.addEventListener('click', () => {
                    const vis = pathRow.style.display !== 'none';
                    pathRow.style.display = vis ? 'none' : 'block';
                    pathBtn.textContent = vis ? 'Path' : 'Hide path';
                });
            }
        }
    }

    async clearAll() {
        try {
            const resp = await api.fetchApi('/model_linker/overrides/clear', { method: 'POST' });
            const data = await resp.json();
            if (data.success) await this.load(); else alert('Clear failed');
        } catch (e) { alert('Clear failed: ' + e.message); }
    }

    export() {
        try {
            const doc = (this.data && this.data.overrides) || { version: 1, mappings: [] };
            const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'overrides.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
        } catch (e) { console.error('Export error', e); }
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
    // Support for new ComfyUI Frontend menu system
    commands: [
        {
            id: "model-linker-open",
            icon: "🔗",
            label: "Model Linker",
            function: () => modelLinker.openLinkerManager()
        }
    ],
    menuCommands: [
        {
            path: ["View"],
            commands: ["model-linker-open"]
        }
    ],
    // Add to canvas right-click menu
    getCanvasMenuItems() {
        return [
            {
                content: "🔗 Model Linker",
                callback: () => modelLinker.openLinkerManager()
            }
        ];
    }
});
