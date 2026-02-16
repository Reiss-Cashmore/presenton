# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

# Collect fastembed dependencies
datas_fastembed, binaries_fastembed, hiddenimports_fastembed = collect_all('fastembed')
datas_fastembed_vs, binaries_fastembed_vs, hiddenimports_fastembed_vs = collect_all('fastembed_vectorstore')
datas_onnx, binaries_onnx, hiddenimports_onnx = collect_all('onnxruntime')

# Collect python-pptx templates and data files
datas_pptx, binaries_pptx, hiddenimports_pptx = collect_all('pptx')

# Collect greenlet - critical for SQLAlchemy async on macOS
# datas_greenlet, binaries_greenlet, hiddenimports_greenlet = collect_all('greenlet')

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries_fastembed + binaries_fastembed_vs + binaries_onnx + binaries_pptx,  # + binaries_greenlet,
    datas=[
        ('assets', 'assets'),
        ('fastembed_cache', 'fastembed_cache'),
        ('static', 'static'),
    ] + datas_fastembed + datas_fastembed_vs + datas_onnx + datas_pptx,  # + datas_greenlet,
    hiddenimports=[
        'aiosqlite',
        'sqlite3',
        'numpy',
        'pandas',
        # 'greenlet',
        # 'greenlet._greenlet',
    ] + hiddenimports_fastembed + hiddenimports_fastembed_vs + hiddenimports_onnx + hiddenimports_pptx,  # + hiddenimports_greenlet,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['docling', 'docling-core', 'docling-ibm-models', 'docling-parse'],
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
