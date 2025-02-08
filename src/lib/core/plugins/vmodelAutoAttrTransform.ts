// This function will be injected into Vue’s compiler pipeline.
// It adds data-auto="true" to any element that has v-model.

import type { NodeTransform } from "@vue/compiler-core"

// Provide a dummy location object
const dummyLoc = {
  start: { line: 0, column: 0, offset: 0 },
  end: { line: 0, column: 0, offset: 0 },
  source: ""
}

export const vmodelAutoAttrTransform: NodeTransform = (node) => {
  // 1. Check if this AST node is a plain element (type: 1).
  // 2. Look for props. If any prop is a directive named "model", we know v-model is used.
  if (node.type === 1 && node.props?.length) {
    const hasVModel = node.props.some(
      prop => prop.type === 7 && prop.name === "model"
    )
    if (hasVModel) {
      // Inject a new static ATTRIBUTE node: data-auto="true"
      node.props.push({
        type: 6, // 6 = ATTRIBUTE
        name: "data-auto", // The attribute name
        value: {
          type: 2, // 2 = TEXT
          content: "true", // The literal string "true"
          loc: dummyLoc,
        },
        loc: dummyLoc,
        nameLoc: dummyLoc,
      })
    }
  }
}
