import { babel } from "@rollup/plugin-babel"
import commonjs from "@rollup/plugin-commonjs"
import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

// Use Node's path separator to ensure cross-platform compatibility
const DIRECTORY_SEPARATOR = path.sep

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
      // **Added**: Ensure unique naming and avoid global variables
      // `name` is only used for UMD/IIFE; safe to omit or ensure uniqueness
    },
    outDir: outputDir,
    rollupOptions: {
      external: ["#app", "vue", "zod"], // Keep external dependencies as is
      plugins: [commonjs()], // Convert CommonJS modules to ES6
      output: {
        // **Removed**: manualChunks to let Rollup handle chunking naturally
        // Over-specifying manualChunks can lead to unexpected duplication

        // **Added**: Define globals for external dependencies if needed
        // This is especially important for UMD/IIFE builds, but not for ES/CJS
        // Since we're using 'es' and 'cjs', this is optional

        // Ensure that each chunk is properly namespaced and does not pollute globals
        // By using ES modules, variables are scoped within modules

        // **Optional**: Define a banner to enforce strict mode and encapsulation
        banner: "\"use strict\";",

        // **Optional**: Use Rollup's output options to further encapsulate code
        // Example: wrapping output in a function (Not typical for ES/CJS)
      },
    },
    // **Optional**: Add sourcemaps for better debugging
    sourcemap: true,

  },
})
