import commonjs from "@rollup/plugin-commonjs"
import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

const DIRECTORY_SEPARATOR = "/"

// Recursive function to collect all .ts files in a directory
function collectTsFiles(dir: string, baseDir: string = dir, entrypoints: Record<string, string> = {}): Record<string, string> {
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

function addBaseDirToEntrypoints(entrypoints: Record<string, string>, basePath: string) {
  const newentrypoints: Record<string, string> = {}

  for (const [key, value] of Object.entries(entrypoints)) {
    const updatedKey = `${basePath}/${key}`
    newentrypoints[updatedKey] = value
  }

  return newentrypoints
}

// Dynamically create entry points for both runtime and lib
const entrypoints = {
  ...addBaseDirToEntrypoints(collectTsFiles(runtimeDir), "runtime"),
  ...addBaseDirToEntrypoints(collectTsFiles(libDir), "lib"),
}

export default defineConfig({
  plugins: [
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
  build: {
    lib: {
      entry: entrypoints,
      formats: ["es", "cjs"],
      fileName: (format, name) => `${name}.${format === "es" ? "mjs" : "cjs"}`,
    },
    outDir: outputDir,
    rollupOptions: {
      external: ["#app", "vue", "zod"],
      plugins: [commonjs()],
      output: {
        preserveModules: true,
      },
    },
  },
})
