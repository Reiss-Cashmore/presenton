# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

# Collect fastembed dependencies
datas_fastembed, binaries_fastembed, hiddenimports_fastembed = collect_all('fastembed')
datas_fastembed_vs, binaries_fastembed_vs, hiddenimports_fastembed_vs = collect_all('fastembed_vectorstore')
datas_onnx, binaries_onnx, hiddenimports_onnx = collect_all('onnxruntime')

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=binaries_fastembed + binaries_fastembed_vs + binaries_onnx,
    datas=[
        ('assets', 'assets'),
        ('fastembed_cache', 'fastembed_cache'),
    ] + datas_fastembed + datas_fastembed_vs + datas_onnx,
    hiddenimports=[
        'aiosqlite',
        'sqlite3',
        'numpy',
        'pandas',
    ] + hiddenimports_fastembed + hiddenimports_fastembed_vs + hiddenimports_onnx,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
