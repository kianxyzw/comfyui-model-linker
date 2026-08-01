"""
Tests for core/matcher.py — run with: python tests/test_matcher.py
(no ComfyUI required; matcher is pure stdlib)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.matcher import (
    normalize_path_separators,
    normalize_path,
    extract_filename,
    find_matches,
)


def test_separator_normalization():
    assert normalize_path_separators('a\\b\\c.safetensors') == 'a/b/c.safetensors'
    assert normalize_path_separators('a/b/c.safetensors') == 'a/b/c.safetensors'
    assert normalize_path('a\\b\\c.safetensors') == normalize_path('a/b/c.safetensors')
    assert normalize_path('') == ''


def test_extract_filename_cross_os():
    # Must work for both separator styles regardless of host OS
    assert extract_filename('subdir\\model.safetensors') == 'model.safetensors'
    assert extract_filename('subdir/model.safetensors') == 'model.safetensors'
    assert extract_filename('a\\b/c\\model.ckpt') == 'model.ckpt'
    assert extract_filename('model.safetensors') == 'model.safetensors'


def test_windows_path_on_linux_gets_100():
    # Issue #8: identical path, only separators differ -> must be 100%
    candidates = [{'filename': 'model.safetensors', 'relative_path': 'SDXL/model.safetensors',
                   'path': '/models/loras/SDXL/model.safetensors'}]
    matches = find_matches('SDXL\\model.safetensors', candidates)
    assert matches, 'expected a match'
    assert matches[0]['confidence'] == 100.0, f"got {matches[0]['confidence']}"


def test_linux_path_target_matches_relative_path():
    # Bug: relative_path was only checked when 'path' was empty (elif chain)
    candidates = [{'filename': 'model.safetensors', 'relative_path': 'SDXL/model.safetensors',
                   'path': 'C:\\ComfyUI\\models\\loras\\SDXL\\model.safetensors'}]
    matches = find_matches('SDXL/model.safetensors', candidates)
    assert matches[0]['confidence'] == 100.0, f"got {matches[0]['confidence']}"


def test_subfolder_target_still_matches_bare_filename():
    # Filename-only exact match must survive a subfolder prefix on the target
    candidates = [{'filename': 'model.safetensors', 'path': '/x/model.safetensors'}]
    matches = find_matches('SomeFolder\\model.safetensors', candidates)
    assert matches[0]['confidence'] == 100.0, f"got {matches[0]['confidence']}"


def test_different_files_not_100():
    candidates = [{'filename': 'model_v2.safetensors', 'path': '/x/model_v2.safetensors'}]
    matches = find_matches('model_v1.safetensors', candidates)
    assert matches[0]['confidence'] < 100.0


def test_fuzzy_still_ranks():
    candidates = [
        {'filename': 'epicrealism_v5.safetensors', 'path': '/x/epicrealism_v5.safetensors'},
        {'filename': 'totally_other.ckpt', 'path': '/x/totally_other.ckpt'},
    ]
    matches = find_matches('epicRealism-v5.safetensors', candidates)
    assert matches[0]['filename'] == 'epicrealism_v5.safetensors'
    assert matches[0]['confidence'] == 100.0  # separators normalized in filename comparison


def test_category_mismatch_flagged():
    # Issue #3: file exists but in a folder the node can't load from
    candidates = [
        {'filename': 'model.safetensors', 'path': '/m/loras/model.safetensors', 'category': 'loras'},
        {'filename': 'model.safetensors', 'path': '/m/diff/model.safetensors', 'category': 'diffusion_models'},
    ]
    matches = find_matches('model.safetensors', candidates,
                           expected_categories=['diffusion_models'])
    assert len(matches) == 2
    # Right-folder match must rank first at equal similarity
    assert matches[0]['model']['category'] == 'diffusion_models'
    assert matches[0]['category_mismatch'] is False
    assert matches[1]['model']['category'] == 'loras'
    assert matches[1]['category_mismatch'] is True


def test_no_expected_categories_means_no_mismatch():
    candidates = [{'filename': 'model.safetensors', 'path': '/m/loras/model.safetensors',
                   'category': 'loras'}]
    matches = find_matches('model.safetensors', candidates)
    assert matches[0]['category_mismatch'] is False


def test_unknown_candidate_category_not_flagged():
    candidates = [{'filename': 'model.safetensors', 'path': '/m/model.safetensors'}]
    matches = find_matches('model.safetensors', candidates,
                           expected_categories=['diffusion_models'])
    assert matches[0]['category_mismatch'] is False


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
