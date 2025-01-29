import { toRef } from "vue"

import { useState } from "#app"

export default function useCount() {
	const count = useState("count", () => 0)
	const x = toRef(4)
	console.log("🚀 ~ useCount ~ x:", x)
	return count
}
