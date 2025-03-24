export function setDifference<T>(primary: Set<T>, secondary: Set<T>) {
  if ('difference' in primary && typeof primary.difference === 'function') {
    return primary.difference(secondary) as Set<T>
  }

  const diff = new Set<T>()
  for (const item of primary) {
    if (!secondary.has(item)) {
      diff.add(item)
    }
  }

  return diff
}

export function setIntersection<T>(firstSet: Set<T>, secondSet: Set<T>, ...otherSets: Set<T>[]) {
  const allSets = [firstSet, secondSet, ...otherSets]
  const smallestSet = allSets.reduce(
    (prev, curr) => (curr.size < prev.size ? curr : prev),
    firstSet
  )

  const intersection = new Set<T>()
  for (const item of smallestSet) {
    if (allSets.every((set) => set.has(item))) {
      intersection.add(item)
    }
  }

  return intersection
}
