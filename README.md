# ComfyUI Model Linker Extension

A ComfyUI extension that helps users relink missing models in workflows using fuzzy matching.

https://github.com/user-attachments/assets/fedf3645-aa66-49f7-b01d-8c3b5127faf4

![Model Linker Interface](model-linker.png)


## Features

- Scans all nodes in workflows to find missing models
- Uses fuzzy matching to suggest similar model files
- Updates workflow JSON in UI/memory (user saves themselves)
- Supports all node types
- Optional auto-resolve for 100% confidence matches

## Installation

1. Clone or download this repository
2. Place it in your ComfyUI custom_nodes/ directory
3. Restart ComfyUI

## Usage

1. Open a workflow with missing models
2. Click the "ðŸ”— Model Linker" button in ComfyUI's top menu bar
3. Review missing models and their suggested matches 
4. Click "Resolve" for individual models or "Auto-Resolve 100% Matches" for perfect matches
5. Save your workflow when ready

## Features

- **Subgraph Support**: Automatically detects and handles missing models inside subgraphs
- **Smart Matching**: Shows 100% confidence matches when available, otherwise shows best matches (â‰¥70% confidence)
- **Fuzzy Matching**: Uses intelligent similarity scoring to find model files even with different naming
- **Auto-Resolve**: One-click resolution for all perfect matches

