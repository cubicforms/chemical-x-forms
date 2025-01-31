import { babel } from "@rollup/plugin-babel"
import commonjs from "@rollup/plugin-commonjs"
import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

const DIRECTORY_SEPARATOR = "/"

// Recursive function to collect all .ts files in a directory
function collectTsFiles(
  dir: string,
  baseDir: string = dir,
  entrypoints: Record<string, string> = {},
): Record<string, string> {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const fullPath = path.join(dir, file)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      collectTsFiles(fullPath, baseDir, entrypoints)
    }
    else if (file.endsWith(".ts")) {
      // Create a unique name for each entry by replacing path separators with hyphens
      const relativePath = path.relative(baseDir, fullPath).replace(/\.ts$/, "")
      const name = relativePath.split(path.sep).join(DIRECTORY_SEPARATOR)
      entrypoints[name] = fullPath
    }
  }
  return entrypoints
}

const runtimeDir = path.resolve(__dirname, "src/runtime")
const libDir = path.resolve(__dirname, "src/lib")
const outputDir = path.resolve(__dirname, "dist/vite")

function addBaseDirToEntrypoints(
  entrypoints: Record<string, string>,
  basePath: string,
) {
  const newEntrypoints: Record<string, string> = {}

  for (const [key, value] of Object.entries(entrypoints)) {
    const updatedKey = `${basePath}/${key}`
    newEntrypoints[updatedKey] = value
  }

  return newEntrypoints
}

// Dynamically create entry points for both runtime and lib
const entrypoints = {
  ...addBaseDirToEntrypoints(collectTsFiles(runtimeDir), "runtime"),
  ...addBaseDirToEntrypoints(collectTsFiles(libDir), "lib"),
}

export default defineConfig({
  plugins: [
    // Babel plugin to optimize lodash-es imports
    babel({
      babelHelpers: "bundled",
      plugins: ["lodash"],
      extensions: [".js", ".ts"],
      include: ["src/**/*"],
    }),
    // Generate TypeScript declaration files
    dts({
      include: [
        "src/runtime/**/*.ts",
        "src/lib/**/*.ts",
        "types/**/*.d.ts",
      ],
      outDir: outputDir,
      entryRoot: "src",
      tsconfigPath: path.resolve(__dirname, "tsconfig.json"),
    }),
  ],
  optimizeDeps: {
    // No need to include lodash-es explicitly; Vite handles ES modules well
  },
  build: {
    lib: {
      entry: entrypoints,
      formats: ["es", "cjs"],
      fileName: (format, name) =>
        `${name}.${format === "es" ? "mjs" : "cjs"}`,
    },
    outDir: outputDir,
    rollupOptions: {
      external: ["#app", "vue", "zod"],
      plugins: [commonjs()],
      output: {
        // Define manualChunks to separate lodash-es and immer into external-bundles
        manualChunks(id) {
          if (id.includes("node_modules/lodash-es")) {
            return "external-bundles/lodash-es"
          }
          if (id.includes("node_modules/immer")) {
            return "external-bundles/immer"
          }
        },
        // Configure chunk file names to place them into their respective folders
        chunkFileNames: (chunkInfo) => {
          // If the chunk is part of external-bundles, place it accordingly
          if (
            chunkInfo.name?.startsWith("external-bundles/lodash-es")
            || chunkInfo.name?.startsWith("external-bundles/immer")
          ) {
            // Remove 'external-bundles/' from the name to avoid double nesting
            const name = chunkInfo.name.replace("external-bundles/", "")
            return `external-bundles/${name}/[name].js`
          }
          // Default naming for other chunks
          return `chunks/[name].js`
        },
        // Optionally, you can configure assetFileNames if you have assets
        // assetFileNames: (assetInfo) => {
        //   // Example: Place all assets in the assets folder
        //   return `assets/[name].[hash][extname]`
        // },
      },
    },
  },
})
