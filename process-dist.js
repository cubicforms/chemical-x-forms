import fs from "fs-extra"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Emulate __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Processes the dist folder by performing the following:
 * 1. Replaces dist/nuxt-module/runtime with dist/vite/runtime.
 * 2. Copies everything else from dist/vite to dist/nuxt-module, excluding runtime, replacing if necessary.
 * 3. Deletes the dist/vite folder.
 */
async function processDist() {
  try {
    const distDir = path.resolve(__dirname, "dist")
    const viteDir = path.join(distDir, "vite")
    const nuxtModuleDir = path.join(distDir, "nuxt-module")

    // Ensure nuxt-module directory exists
    await fs.ensureDir(nuxtModuleDir)

    // 1. Replace dist/nuxt-module/runtime with dist/vite/runtime
    const viteRuntimeDir = path.join(viteDir, "runtime")
    const nuxtRuntimeDir = path.join(nuxtModuleDir, "runtime")

    // Check if vite/runtime exists
    const viteRuntimeExists = await fs.pathExists(viteRuntimeDir)
    if (!viteRuntimeExists) {
      throw new Error(`Vite runtime directory does not exist at ${viteRuntimeDir}`)
    }

    // Remove existing nuxt-module/runtime if it exists
    const nuxtRuntimeExists = await fs.pathExists(nuxtRuntimeDir)
    if (nuxtRuntimeExists) {
      await fs.remove(nuxtRuntimeDir)
      console.log(`Removed existing Nuxt module runtime directory at ${nuxtRuntimeDir}`)
    }

    // Copy vite/runtime to nuxt-module/runtime
    await fs.copy(viteRuntimeDir, nuxtRuntimeDir)
    console.log(`Copied Vite runtime from ${viteRuntimeDir} to ${nuxtRuntimeDir}`)

    // 2. Copy everything else from vite to nuxt-module, excluding runtime
    const copyFilter = (src) => {
      // Exclude the 'runtime' directory
      if (src === viteRuntimeDir || src.startsWith(viteRuntimeDir + path.sep)) {
        return false
      }
      return true
    }

    await fs.copy(viteDir, nuxtModuleDir, { overwrite: true, filter: copyFilter })
    console.log(`Copied all other Vite files to Nuxt module, excluding runtime`)

    // 3. Delete the dist/vite folder
    await fs.remove(viteDir)
    console.log(`Deleted Vite directory at ${viteDir}`)

    console.log("processDist completed successfully.")
  }
  catch (error) {
    console.error("Error in processDist:", error)
    process.exit(1)
  }
}

processDist()
