# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_all

# Detect platform
platform = sys.platform
is_windows = platform == 'win32'
is_linux = platform.startswith('linux')
is_macos = platform == 'darwin'

# Collect fastembed dependencies
datas_fastembed, binaries_fastembed, hiddenimports_fastembed = collect_all('fastembed')
datas_fastembed_vs, binaries_fastembed_vs, hiddenimports_fastembed_vs = collect_all('fastembed_vectorstore')
datas_onnx, binaries_onnx, hiddenimports_onnx = collect_all('onnxruntime')

# Collect python-pptx templates and data files
datas_pptx, binaries_pptx, hiddenimports_pptx = collect_all('pptx')

# Collect lightweight document libraries for Windows
if is_windows:
    # PyMuPDF (fitz) for PDF processing
    datas_fitz, binaries_fitz, hiddenimports_fitz = collect_all('fitz')
    # python-docx for DOCX processing
    datas_docx, binaries_docx, hiddenimports_docx = collect_all('docx')
else:
    datas_fitz, binaries_fitz, hiddenimports_fitz = [], [], []
    datas_docx, binaries_docx, hiddenimports_docx = [], [], []

# Collect greenlet - critical for SQLAlchemy async on macOS
# Only include greenlet on macOS, exclude on Linux and Windows
if is_macos:
    datas_greenlet, binaries_greenlet, hiddenimports_greenlet = collect_all('greenlet')
else:
    datas_greenlet, binaries_greenlet, hiddenimports_greenlet = [], [], []

# Platform-specific excludes
# Windows: exclude docling
# Linux: exclude greenlet only (keep docling)
# macOS: include everything (no excludes)
excludes = []
if is_windows:
    excludes = ['docling', 'docling-core', 'docling-ibm-models', 'docling-parse']
elif is_linux:
    excludes = []  # Linux keeps docling, only greenlet is excluded (handled above)
# macOS: no excludes, includes greenlet

# Build binaries list
binaries_list = binaries_fastembed + binaries_fastembed_vs + binaries_onnx + binaries_pptx
if is_windows:
    binaries_list = binaries_list + binaries_fitz + binaries_docx
if is_macos:
    binaries_list = binaries_list + binaries_greenlet

# Build datas list
datas_list = datas_fastembed + datas_fastembed_vs + datas_onnx + datas_pptx
if is_windows:
    datas_list = datas_list + datas_fitz + datas_docx
if is_macos:
    datas_list = datas_list + datas_greenlet

# Build hiddenimports list
hiddenimports_list = [
    'aiosqlite',
    'sqlite3',
    'numpy',
    'pandas',
] + hiddenimports_fastembed + hiddenimports_fastembed_vs + hiddenimports_onnx + hiddenimports_pptx
if is_windows:
    hiddenimports_list = hiddenimports_list + ['fitz', 'docx'] + hiddenimports_fitz + hiddenimports_docx
if is_macos:
    hiddenimports_list = hiddenimports_list + ['greenlet', 'greenlet._greenlet'] + hiddenimports_greenlet

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries_list,
    datas=[
        ('assets', 'assets'),
        ('fastembed_cache', 'fastembed_cache'),
        ('static', 'static'),
    ] + datas_list,
    hiddenimports=hiddenimports_list,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='fastapi',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='fastapi',
)
