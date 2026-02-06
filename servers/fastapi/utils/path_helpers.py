"""
Path resolution utilities for handling different deployment environments.

Supports:
- Development: Normal relative paths
- Docker: Standard file system paths
- PyInstaller (Electron): Paths resolved via sys._MEIPASS
"""

import os
import sys
import tempfile


def get_resource_path(relative_path: str) -> str:
    """
    Get absolute path to a read-only resource (bundled assets).
    
    Works across different environments:
    - Development: Uses current working directory
    - Docker: Uses current working directory
    - PyInstaller: Uses temporary extraction directory (sys._MEIPASS)
    
    Args:
        relative_path: Path relative to the application root
        
    Returns:
        Absolute path to the resource
        
    Example:
        >>> get_resource_path("static/icons/icon.svg")
        '/path/to/static/icons/icon.svg'
    """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
        # Running in PyInstaller bundle
        return os.path.join(base_path, relative_path)
    except AttributeError:
        # Running in normal Python (development or Docker)
        base_path = os.path.abspath(".")
        return os.path.join(base_path, relative_path)


def get_writable_path(relative_path: str) -> str:
    """
    Get absolute path to a writable location (for cache, user data, etc.).
    
    Works across different environments:
    - Development: Uses current working directory
    - Docker: Uses current working directory (volumes should be mounted)
    - PyInstaller: Uses executable directory or falls back to temp directory
    
    Args:
        relative_path: Path relative to the writable base location
        
    Returns:
        Absolute path to a writable location
        
    Example:
        >>> get_writable_path("fastembed_cache")
        '/writable/path/fastembed_cache'
    """
    try:
        # Check if running in PyInstaller bundle
        base_path = sys._MEIPASS
        
        # In packaged mode, try to use a writable location
        # First try: directory where the executable is located
        exe_dir = os.path.dirname(sys.executable)
        writable_path = os.path.join(exe_dir, relative_path)
        
        # Test if writable
        try:
            os.makedirs(writable_path, exist_ok=True)
            # Try to create a test file to verify write access
            test_file = os.path.join(writable_path, '.write_test')
            try:
                with open(test_file, 'w') as f:
                    f.write('test')
                os.remove(test_file)
                return writable_path
            except (IOError, OSError):
                pass
        except (IOError, OSError):
            pass
        
        # Fallback: Use temp directory with app-specific subdirectory
        temp_base = os.path.join(tempfile.gettempdir(), "presenton")
        writable_path = os.path.join(temp_base, relative_path)
        os.makedirs(writable_path, exist_ok=True)
        return writable_path
        
    except AttributeError:
        # Running in normal Python (development or Docker)
        # Use current directory - in Docker, volumes should be mounted
        base_path = os.path.abspath(".")
        writable_path = os.path.join(base_path, relative_path)
        os.makedirs(writable_path, exist_ok=True)
        return writable_path


def is_pyinstaller() -> bool:
    """
    Check if the application is running in a PyInstaller bundle.
    
    Returns:
        True if running in PyInstaller, False otherwise
    """
    return hasattr(sys, '_MEIPASS')


def is_docker() -> bool:
    """
    Check if the application is running in a Docker container.
    
    Returns:
        True if running in Docker, False otherwise
    """
    # Check for common Docker indicators
    if os.path.exists('/.dockerenv'):
        return True
    
    # Check cgroup for docker
    try:
        with open('/proc/1/cgroup', 'rt') as f:
            return 'docker' in f.read()
    except Exception:
        return False


def get_environment_type() -> str:
    """
    Determine the current runtime environment.
    
    Returns:
        'pyinstaller', 'docker', or 'development'
    """
    if is_pyinstaller():
        return 'pyinstaller'
    elif is_docker():
        return 'docker'
    else:
        return 'development'
