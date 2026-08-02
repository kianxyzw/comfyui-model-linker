"""
Tests for core/workflow_analyzer.py — run with: python tests/test_workflow_analyzer.py

Stubs ComfyUI's folder_paths and nodes modules so no ComfyUI install is needed.
"""

import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# --- Build a fake model directory tree ---------------------------------------

TMP = tempfile.mkdtemp(prefix='linker_test_')
DIRS = {
    'loras': ['mylora.safetensors'],
    'diffusion_models': ['qwen.safetensors', os.path.join('sub', 'other.safetensors')],
    'checkpoints': ['sd15.ckpt'],
}
for category, files in DIRS.items():
    base = os.path.join(TMP, category)
    for rel in files:
        path = os.path.join(base, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write('x')

# --- Stub folder_paths and nodes before importing the analyzer ---------------

fp = types.ModuleType('folder_paths')
fp.folder_names_and_paths = {c: ([os.path.join(TMP, c)], set()) for c in DIRS}


def get_filename_list(category):
    return [f.replace('\\', os.sep) for f in DIRS.get(category, [])]


def get_full_path(category, filename):
    path = os.path.join(TMP, category, filename)
    return path if os.path.exists(path) else None


fp.get_filename_list = get_filename_list
fp.get_full_path = get_full_path
sys.modules['folder_paths'] = fp


class FakeCustomLoader:
    """Mimics a custom loader node that builds its combo from folder_paths."""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'model_file': (get_filename_list('diffusion_models'), {'tooltip': 'x'}),
                'steps': ('INT', {'default': 4}),
            },
            'optional': {},
        }


class FakeNonModelNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'text': ('STRING', {})}}


nodes_mod = types.ModuleType('nodes')
nodes_mod.NODE_CLASS_MAPPINGS = {
    'FakeCustomLoader': FakeCustomLoader,
    'FakeNonModelNode': FakeNonModelNode,
}
sys.modules['nodes'] = nodes_mod

from core.workflow_analyzer import (  # noqa: E402
    get_node_model_categories,
    get_node_model_info,
    group_models_by_file,
    identify_missing_models,
    try_resolve_model_path,
)


def test_introspection_derives_category():
    assert get_node_model_categories('FakeCustomLoader') == ['diffusion_models']


def test_introspection_non_model_node():
    assert get_node_model_categories('FakeNonModelNode') is None


def test_introspection_unknown_node():
    assert get_node_model_categories('NoSuchNode') is None


def test_custom_loader_missing_model_gets_category():
    node = {'id': 7, 'type': 'FakeCustomLoader',
            'widgets_values': ['not_downloaded.safetensors', 4]}
    refs = get_node_model_info(node)
    assert len(refs) == 1
    ref = refs[0]
    assert ref['exists'] is False
    assert ref['category'] == 'diffusion_models'
    assert ref['expected_categories'] == ['diffusion_models']


def test_custom_loader_existing_model_resolves():
    node = {'id': 8, 'type': 'FakeCustomLoader',
            'widgets_values': ['qwen.safetensors', 4]}
    refs = get_node_model_info(node)
    assert refs[0]['exists'] is True
    assert refs[0]['category'] == 'diffusion_models'


def test_wrong_folder_model_is_reported_missing():
    # Issue #3 scenario: file exists, but only in 'loras', while the node
    # loads from 'diffusion_models' -> must be reported missing
    node = {'id': 9, 'type': 'FakeCustomLoader',
            'widgets_values': ['mylora.safetensors', 4]}
    refs = get_node_model_info(node)
    assert refs[0]['exists'] is False
    assert refs[0]['expected_categories'] == ['diffusion_models']


def test_resolve_handles_both_separator_styles():
    # Issue #8: workflows authored on the other OS use the other separator
    assert try_resolve_model_path('sub/other.safetensors', ['diffusion_models']) is not None
    assert try_resolve_model_path('sub\\other.safetensors', ['diffusion_models']) is not None


def test_group_models_by_file():
    refs = [
        {'node_id': 1, 'widget_index': 0, 'original_path': 'a.safetensors', 'exists': False},
        {'node_id': 2, 'widget_index': 1, 'original_path': 'a.safetensors', 'exists': False},
        {'node_id': 3, 'widget_index': 0, 'original_path': 'b.safetensors', 'exists': True},
    ]

    missing = group_models_by_file(refs, exists_filter=False)
    assert len(missing) == 1
    assert missing[0]['original_path'] == 'a.safetensors'
    assert len(missing[0]['all_node_refs']) == 2
    assert [r['node_id'] for r in missing[0]['all_node_refs']] == [1, 2]

    resolved = group_models_by_file(refs, exists_filter=True)
    assert len(resolved) == 1
    assert resolved[0]['original_path'] == 'b.safetensors'

    everything = group_models_by_file(refs)
    assert len(everything) == 2

    # identify_missing_models must behave exactly as before the refactor
    assert identify_missing_models(refs) == missing


def test_known_node_type_still_uses_hint():
    node = {'id': 10, 'type': 'CheckpointLoaderSimple',
            'widgets_values': ['sd15.ckpt']}
    refs = get_node_model_info(node)
    assert refs[0]['exists'] is True
    assert refs[0]['category'] == 'checkpoints'


if __name__ == '__main__':
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print(f'PASS {name}')
            except AssertionError as e:
                failures += 1
                print(f'FAIL {name}: {e}')
    sys.exit(1 if failures else 0)
