// // vite.config.ts
// import fs from "node:fs"
// import path from "node:path"

// import commonjs from "@rollup/plugin-commonjs"
// import { defineConfig } from "vite"
// import dts from "vite-plugin-dts"

// // Paths
// const composablesDir = path.resolve(__dirname, "src/runtime/composables")
// const outputDir = path.resolve(__dirname, "dist/runtime/composables")

// // Get entry points
// const entries = fs.readdirSync(composablesDir)
// 	.filter(file => file.endsWith(".ts"))
// 	.reduce((acc, file) => {
// 		const name = path.basename(file, ".ts")
// 		acc[name] = path.join(composablesDir, file)
// 		return acc
// 	}, {} as Record<string, string>)

// export default defineConfig({
// 	plugins: [
// 		dts({
// 			include: ["src/runtime/composables/**/*.ts"],
// 			outDir: outputDir,
// 			entryRoot: "src/runtime/composables",
// 			tsconfigPath: path.resolve(__dirname, "tsconfig.json"),
// 		}),
// 		commonjs(),
// 	],
// 	build: {
// 		lib: {
// 			entry: entries,
// 			formats: ["es", "cjs"],
// 			fileName: (format, name) => `${name}.${format === "es" ? "mjs" : "cjs"}`,
// 		},
// 		outDir: outputDir,
// 		rollupOptions: {
// 			external: ["#app", "vue"],
// 			output: {
// 				preserveModules: true,
// 				// entryFileNames: "[name].[ext]",
// 				// chunkFileNames: "[name].mjs",
// 			},
// 		},
// 	},
// })

// vite.config.ts
import fs from "node:fs"
import path from "node:path"

import commonjs from "@rollup/plugin-commonjs"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

const composablesDir = path.resolve(__dirname, "src/runtime/composables")
const outputDir = path.resolve(__dirname, "dist/runtime/composables")

// Dynamically create entry points
const entries = fs.readdirSync(composablesDir)
	.filter(file => file.endsWith(".ts"))
	.reduce((acc, file) => {
		const name = path.basename(file, ".ts")
		acc[name] = path.join(composablesDir, file)
		return acc
	}, {} as Record<string, string>)

export default defineConfig({
	plugins: [
		dts({
			include: ["src/runtime/composables/**/*.ts", "types/**/*.d.ts"],
			outDir: outputDir,
			entryRoot: "src/runtime/composables",
			tsconfigPath: path.resolve(__dirname, "tsconfig.json"),
		}),
	],
	build: {
		lib: {
			entry: entries,
			formats: ["es", "cjs"],
			fileName: (format, name) => `${name}.${format === "es" ? "mjs" : "cjs"}`,
		},
		outDir: outputDir,
		rollupOptions: {
			external: ["#app", "vue"],
			plugins: [commonjs()],
			output: {
				preserveModules: true,
			},
		},
	},
})
