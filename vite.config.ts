import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

// Define the directory separator for cross-platform compatibility
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
// const libDir = path.resolve(__dirname, "src/lib")
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
  // ...addBaseDirToEntrypoints(collectTsFiles(libDir), "lib"),
}

export default defineConfig({
  plugins: [
    // Removed Babel and babel-plugin-lodash to prevent deprecated transformations
    // If Babel is necessary for your project, ensure it's configured without the lodash plugin
    // Generate TypeScript declaration files
    dts({
      include: [
        "src/runtime/**/*.ts",
        // "src/lib/**/*.ts",
        "src/types/**/*.ts",
        "types/**/*.d.ts",
      ],
      outDir: outputDir,
      entryRoot: "src",
      tsconfigPath: path.resolve(__dirname, "tsconfig.json"),
    }),
  ],
  optimizeDeps: {
    // Let Vite handle ES module optimizations
  },
  build: {
    // Switch minifier to 'terser' for better variable mangling
    minify: "terser",
    terserOptions: {
      mangle: {
        // Enable top-level variable mangling to prevent name collisions
        toplevel: true,
      },
      compress: {
        drop_console: true, // Optional: remove console statements
      },
      format: {
        comments: false, // Remove all comments
      },
    },
    lib: {
      entry: entrypoints,
      formats: ["es", "cjs"],
      fileName: (format, name) =>
        `${name}.${format === "es" ? "mjs" : "cjs"}`,
    },
    outDir: outputDir,
    rollupOptions: {
      external: ["#app", "vue", "zod", "immer", "lodash-es",
        // /.*\.d\.ts$/, // regex to match any .d.ts file in the source
      ],
      output: {
        // Allow Rollup to handle chunking automatically without manualChunks
        chunkFileNames: "chunks/[name]-[hash].js",
        // Optionally, set entryFileNames and assetFileNames if needed
        // entryFileNames: 'entry/[name].js',
        // assetFileNames: 'assets/[name].[hash][extname]',
        // assetFileNames: (assetInfo) => {
        //   // Exclude .d.ts files from being processed
        //   const name = assetInfo.names[0]
        //   if (!name) return ""

        //   if (name.endsWith(".d.ts")) {
        //     return "" // Don't include .d.ts files in the output
        //   }
        //   return "[name]" // For other files, use the default output name
        // },
      },
      // Remove the commonjs plugin as Vite handles CommonJS internally
      // plugins: [commonjs()], // Removed
    },
    // Optional: Enable source maps for debugging
    sourcemap: false,
    // Optional: Disable minification temporarily to debug
    // minify: false,
  },
})
