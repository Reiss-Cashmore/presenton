const builder = require("electron-builder")
const fs = require("fs")
const path = require("path")

// AfterPack hook to set executable permissions on macOS
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
    
    // Also check for any Python bundled executables  
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
}


builder.build({ config })