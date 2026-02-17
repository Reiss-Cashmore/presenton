"""
Runtime hook to fix docling metadata lookup in PyInstaller builds.

PyInstaller doesn't always preserve package metadata (dist-info) in a way that
importlib.metadata can find it. This hook patches the version lookup to return
a default version if metadata isn't found, allowing docling to import successfully.
"""
import sys

# Only apply this fix when running in PyInstaller bundle
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    try:
        import importlib.metadata
        
        # Store original version function
        _original_version = importlib.metadata.version
        
        def _patched_version(package_name):
            """Patched version that handles missing metadata gracefully."""
            try:
                return _original_version(package_name)
            except importlib.metadata.PackageNotFoundError:
                # For docling packages, return a default version if metadata not found
                if package_name in ('docling', 'docling-core', 'docling-parse', 'docling-ibm-models'):
                    # Return a reasonable default version to allow import to proceed
                    return '2.43.0'
                raise
        
        # Patch the version function
        importlib.metadata.version = _patched_version
        
    except Exception:
        # If patching fails, continue anyway
        pass
