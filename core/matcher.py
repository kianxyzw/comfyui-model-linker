"""
Fuzzy Matcher Module

Implements fuzzy string matching to find similar model names.
"""

import os
import posixpath
import re
from typing import List, Dict, Tuple
from difflib import SequenceMatcher


def normalize_path_separators(path: str) -> str:
    """
    Convert backslashes to forward slashes.

    Workflows are shared across OSes, so a path authored on Windows
    (subdir\\model.safetensors) must compare equal to the same path on
    Linux (subdir/model.safetensors). os.path functions can't do this:
    on Linux a backslash is a regular filename character.
    """
    return path.replace('\\', '/') if path else ''


def normalize_path(path: str) -> str:
    """Normalize a path for cross-OS comparison (separators + redundant parts)."""
    if not path:
        return ''
    return posixpath.normpath(normalize_path_separators(path))


def extract_filename(path: str) -> str:
    """Get the final path component regardless of separator style."""
    return normalize_path_separators(path).rstrip('/').rsplit('/', 1)[-1]


def normalize_filename(filename: str) -> str:
    """
    Normalize a filename for comparison.
    
    Removes file extension, converts to lowercase, and normalizes
    separators (underscores, hyphens, spaces).
    
    Args:
        filename: Filename to normalize
        
    Returns:
        Normalized string for comparison
    """
    # Remove file extension
    base = os.path.splitext(filename)[0]
    
    # Convert to lowercase
    base = base.lower()
    
    # Normalize separators: replace underscores, hyphens, and spaces with a single space
    base = re.sub(r'[_\-\s]+', ' ', base)
    
    # Strip whitespace
    base = base.strip()
    
    return base


def calculate_similarity(str1: str, str2: str) -> float:
    """
    Calculate similarity score between two strings (0.0 to 1.0).
    
    Uses SequenceMatcher to compute a ratio.
    
    Args:
        str1: First string
        str2: Second string
        
    Returns:
        Similarity score from 0.0 (completely different) to 1.0 (identical)
    """
    return SequenceMatcher(None, str1, str2).ratio()


def calculate_similarity_with_normalization(str1: str, str2: str) -> float:
    """
    Calculate similarity score with filename normalization.
    
    Normalizes both strings before comparing.
    
    Args:
        str1: First string (typically model filename)
        str2: Second string (typically candidate model filename)
        
    Returns:
        Similarity score from 0.0 to 1.0
    """
    norm1 = normalize_filename(str1)
    norm2 = normalize_filename(str2)
    return calculate_similarity(norm1, norm2)


def find_matches(
    target_model: str,
    candidate_models: List[Dict[str, str]],
    threshold: float = 0.0,
    max_results: int = 10,
    expected_categories: List[str] = None
) -> List[Dict[str, any]]:
    """
    Find similar models using fuzzy matching.

    Args:
        target_model: The target model filename/path to match
        candidate_models: List of candidate model dictionaries with 'filename' or 'path' key
        threshold: Minimum similarity score (0.0 to 1.0) to include in results
        max_results: Maximum number of results to return
        expected_categories: Folder categories the referencing node loads from.
            Candidates outside these are flagged 'category_mismatch' — the
            node couldn't actually load them from where they are (issue #3)

    Returns:
        List of match dictionaries sorted by similarity (highest first,
        right-folder matches before wrong-folder ones at equal similarity):
        {
            'model': original model dict from candidates,
            'filename': model filename,
            'similarity': similarity score (0.0 to 1.0),
            'confidence': confidence percentage (0 to 100),
            'category_mismatch': True if the file is in a folder the node
                                 doesn't load from,
            'expected_categories': the expected categories (when known)
        }
    """
    matches = []

    def category_mismatch(candidate):
        if not expected_categories:
            return False
        candidate_category = candidate.get('category')
        if not candidate_category:
            return False  # Unknown candidate category - don't flag
        return candidate_category not in expected_categories
    
    # Normalize path separators to forward slashes so Windows- and
    # Linux-authored workflow paths compare identically on either OS
    target_model_normalized = normalize_path(target_model)

    # Extract just the filename from target_model (remove any subfolder paths)
    # target_model might be just a filename or might include subfolder paths
    target_filename = extract_filename(target_model)
    
    # Normalize target filename once for exact match comparisons
    target_norm = normalize_filename(target_filename)
    
    for candidate in candidate_models:
        # Get filename from candidate (prefer 'filename' key, fallback to extracting from 'path' or 'relative_path')
        candidate_filename = candidate.get('filename')
        candidate_path = candidate.get('path', '') or candidate.get('relative_path', '')
        
        # If no filename key, try to extract from path or relative_path
        if not candidate_filename:
            if candidate_path:
                candidate_filename = extract_filename(candidate_path)

        if not candidate_filename:
            continue

        # Normalize candidate paths for cross-OS comparison
        candidate_path_normalized = normalize_path(candidate_path)
        candidate_relative_path = candidate.get('relative_path', '')
        candidate_relative_path_normalized = normalize_path(candidate_relative_path)

        # Check if normalized paths are identical (100% match)
        # This handles cases where paths differ only by separator (e.g., path/to/model vs path\to\model)
        # The target is usually relative, so check both the absolute and relative candidate paths
        path_match = False
        if target_model_normalized:
            if candidate_path_normalized and candidate_path_normalized == target_model_normalized:
                path_match = True
            elif candidate_relative_path_normalized and candidate_relative_path_normalized == target_model_normalized:
                path_match = True
        
        if path_match:
            # Exact path match after normalization = 100% confidence
            similarity = 1.0
            matches.append({
                'model': candidate,
                'filename': candidate_filename,
                'similarity': similarity,
                'confidence': round(similarity * 100, 1),
                'category_mismatch': category_mismatch(candidate),
                'expected_categories': expected_categories
            })
            continue
        
        # Calculate similarity comparing just filenames (not paths)
        # This ensures we're comparing apples to apples
        
        # First check for exact match (after normalization) - should be 100%
        # Only exact matches should get 100% confidence
        candidate_norm = normalize_filename(candidate_filename)
        
        if target_norm == candidate_norm:
            # Exact match after normalization = 100% confidence
            similarity = 1.0
        else:
            # Calculate similarity using SequenceMatcher
            # This gives a ratio between 0.0 and 1.0 based on longest common subsequence
            similarity = calculate_similarity_with_normalization(target_filename, candidate_filename)
            
            # Also try comparing without extensions for better matching
            target_base = os.path.splitext(target_filename)[0]
            candidate_base = os.path.splitext(candidate_filename)[0]
            similarity_no_ext = calculate_similarity_with_normalization(target_base, candidate_base)
            
            # Use the higher of the two similarity scores
            # But ensure we never get 1.0 unless it's an exact normalized match
            similarity = max(similarity, similarity_no_ext)
            
            # Cap similarity at 0.999 for non-exact matches to prevent false 100% scores
            # SequenceMatcher can sometimes give 1.0 for very similar but not identical strings
            # due to normalization artifacts
            if similarity >= 0.999 and target_norm != candidate_norm:
                similarity = 0.999
        
        # Only include if above threshold
        if similarity >= threshold:
            matches.append({
                'model': candidate,
                'filename': candidate_filename,
                'similarity': similarity,
                'confidence': round(similarity * 100, 1),  # Convert to percentage
                'category_mismatch': category_mismatch(candidate),
                'expected_categories': expected_categories
            })

    # Sort by similarity (highest first); at equal similarity, right-folder
    # matches rank above wrong-folder ones
    matches.sort(key=lambda x: (x['similarity'], not x['category_mismatch']), reverse=True)
    
    # Limit to max_results
    matches = matches[:max_results]
    
    return matches

