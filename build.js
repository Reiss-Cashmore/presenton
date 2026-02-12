const builder = require("electron-builder")
const fs = require("fs")
const path = require("path")

// AfterPack hook: set executable permissions on macOS; no-op on Windows
const afterPack = async (context) => {
  if (context.electronPlatformName === "darwin") {
    const appPath = context.appOutDir
    const fastapiPath = path.join(appPath, "Presenton.app/Contents/Resources/app/resources/fastapi/fastapi")

    console.log("Setting executable permissions for FastAPI binary...")
    console.log("FastAPI path:", fastapiPath)

    if (fs.existsSync(fastapiPath)) {
      fs.chmodSync(fastapiPath, 0o755)
      console.log("✓ Execute permissions set for FastAPI")
    } else {
      console.warn("⚠ FastAPI binary not found at:", fastapiPath)
    }

    const fastapiDir = path.join(appPath, "Presenton.app/Contents/Resources/app/resources/fastapi")
    if (fs.existsSync(fastapiDir)) {
      console.log("FastAPI directory contents:", fs.readdirSync(fastapiDir))
    }
  }
}

const config = {
  appId: "ai.presenton",
  asar: false,
  directories: {
    output: "dist",
    buildResources: "build",
  },
  files: [
    "resources",
    "app_dist",
    "node_modules",
    "NOTICE",
  ],
  afterPack,
  mac: {
    artifactName: "Presenton-${version}.${ext}",
    target: ["dmg"],
    category: "public.app-category.productivity",
    icon: "resources/ui/assets/images/presenton_short_filled.png",
  },
  linux: {
    artifactName: "Presenton-${version}.${ext}",
    target: ["AppImage"],
    icon: "resources/ui/assets/images/presenton_short_filled.png",
  },
  win: {
    artifactName: "Presenton-${version}.${ext}",
    // Build NSIS only; AppX (MakeAppx) can fail with 0x8007007b due to long paths
    // in the FastAPI bundle or reserved names. Use NSIS for installers.
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "resources/ui/assets/images/presenton.ico",
    requestedExecutionLevel: "asInvoker",
    // Skip rcedit (set exe metadata) to avoid "Unable to commit changes" when exe is locked (e.g. OneDrive)
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "resources/ui/assets/images/presenton.ico",
    uninstallerIcon: "resources/ui/assets/images/presenton.ico",
  },
}

builder.build({ config })