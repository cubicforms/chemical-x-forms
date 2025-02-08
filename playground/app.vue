<script setup lang="ts">
import type { VNode } from "vue"
import { getCurrentInstance, onMounted } from "vue"

onMounted(() => {
  const instance = getCurrentInstance()
  if (instance) {
    console.log("VNode Tree:")
    const treeGraph = traverseVNodeTree(instance.subTree)
    console.log(treeGraph)
  }
})

// Recursive function to traverse and build the VNode tree graph
function traverseVNodeTree(vnode: VNode, depth = 0): string {
  if (!vnode) return ""

  // Format current node information
  const indent = "  ".repeat(depth)
  let output = `${indent}- ${getNodeDescription(vnode)}\n`

  // Recursively traverse children if they exist
  if (Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      if (typeof child === "object") {
        output += traverseVNodeTree(child, depth + 1)
      }
    }
  }

  return output
}

// Helper to format the VNode description
function getNodeDescription(vnode: VNode): string {
  const tag = vnode.type && typeof vnode.type === "object"
    ? "Component"
    : vnode.type ?? "Unknown"

  // Extract key props for visibility (if present)
  const props = vnode.props ? JSON.stringify(vnode.props) : ""
  console.log(tag, Object.keys(vnode), vnode.ref, vnode.el, vnode.target, vnode.appContext, (vnode as unknown as { ctx: unknown }).ctx)

  return `${tag.toString()}${props ? ` - Props: ${props}` : ""}`
}

const val = ref("hello")
</script>

<template>
  <div>
    <h1>Hello Vue!</h1>
    <p>A paragraph of text.</p>
    <input
      v-model="val"
      placeholder="input is here"
    >
  </div>
</template>
