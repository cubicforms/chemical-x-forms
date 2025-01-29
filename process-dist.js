import fs from "fs-extra"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Emulate __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Processes the dist folder by performing the following:
 * 1. Replaces dist/nuxt-module/runtime with dist/vite/runtime.
 * 2. Copies dist/vite/lib to dist/nuxt-module (replacing if necessary).
 * 3. Deletes the dist/vite folder in the dist directory.
 */
async function processDist() {
  try {
    const distDir = path.resolve(__dirname, "dist")
    const viteDir = path.join(distDir, "vite")
    const nuxtModuleDir = path.join(distDir, "nuxt-module")

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

    // 2. Copy dist/vite/lib to dist/nuxt-module/lib (replace if necessary)
    const viteLibDir = path.join(viteDir, "lib")
    const nuxtLibDir = path.join(nuxtModuleDir, "lib")

    // Check if vite/lib exists
    const viteLibExists = await fs.pathExists(viteLibDir)
    if (viteLibExists) {
      // Copy vite/lib to nuxt-module/lib, replacing if necessary
      await fs.copy(viteLibDir, nuxtLibDir, { overwrite: true })
      console.log(`Copied Vite lib from ${viteLibDir} to ${nuxtLibDir}`)
    }
    else {
      console.warn(`Vite lib directory does not exist at ${viteLibDir}, skipping copy.`)
    }

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
