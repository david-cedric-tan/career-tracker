/**
 * Hub-and-spoke ring geometry, shared by the three bubble views (network
 * contacts by company, companies by industry, applications by stage).
 *
 * All three drew the same ring with the same numbers copied three times, and
 * the same flaw in each: the radius was `max(floor, spokes * arc / 2π)`, whose
 * floor swallowed every ring up to six or so spokes. A one-spoke ring and a
 * six-spoke ring came out the same size, so the busy ones ran their labels
 * into each other while the quiet ones floated in space.
 *
 * What replaces it grows the ring with its contents: a steady radius per
 * spoke, with a minimum chord taking over on the busiest rings to keep
 * neighbouring labels apart.
 */

/** The pieces a ring is drawn from, in px. */
export type RingDims = {
  /** Diameter of the centre node. */
  hub: number
  /** Diameter of each spoke node. */
  node: number
  /** Height reserved for a spoke's text label. */
  label: number
  /** Width reserved for a spoke's text label — what sets the minimum chord. */
  labelW: number
  /** Breathing room around the whole diagram. */
  pad: number
}

export type RingGrowth = {
  /** Radius of a single-spoke ring. */
  minRadius: number
  /** Added per extra spoke, so the ring opens up as it fills. */
  perSpoke: number
  /** Straight-line distance neighbours must keep, so labels never collide. */
  minChord: number
  /** Widest a *single* ring is allowed to get. Past it the spokes spread into
      concentric orbits instead, which grows the diagram with the square root
      of the count rather than linearly. */
  maxRadius: number
  /** Radial distance between orbits — a node plus its label, plus margin. */
  orbitGap: number
}

/** Growth tuned to a set of dimensions: enough gap to clear the hub and the
    node, and a chord wide enough for the label plus a margin. */
export function growthFor(dims: RingDims, gap = 28): RingGrowth {
  return {
    minRadius: dims.hub / 2 + dims.node / 2 + gap,
    perSpoke: Math.round(gap / 3),
    minChord: dims.labelW + gap,
    maxRadius: dims.labelW * 2 + dims.hub,
    orbitGap: dims.node + dims.label + Math.round(gap / 2),
  }
}

/** Whichever is larger: the steady growth per spoke, or the radius the
    busiest rings need to keep neighbours from touching. */
export function ringRadius(spokes: number, growth: RingGrowth): number {
  const steady = growth.minRadius + growth.perSpoke * (spokes - 1)
  const spaced = spokes < 2 ? 0 : growth.minChord / (2 * Math.sin(Math.PI / spokes))
  return Math.max(steady, spaced)
}

/** How many spokes fit on one ring of this radius without their labels
    touching. */
function ringCapacity(radius: number, minChord: number): number {
  const ratio = minChord / (2 * radius)
  if (ratio >= 1) return 1
  return Math.max(1, Math.floor(Math.PI / Math.asin(ratio)))
}

type Orbit = { radius: number; count: number }

/**
 * Splits `count` spokes into concentric orbits, every one of them placed —
 * nothing is ever dropped or folded into a "+N".
 *
 * One ring for as long as one ring can hold them; past that the spokes spread
 * outward across as few orbits as fit them, each orbit taking a share of the
 * total in proportion to how much room it has. Sharing by capacity is what
 * keeps the density even: filling each orbit to the brim in turn would leave a
 * crowded inner ring circled by two or three stragglers.
 */
function orbitPlan(count: number, growth: RingGrowth): Orbit[] {
  if (count <= 0) return []
  if (count <= ringCapacity(growth.maxRadius, growth.minChord)) {
    return [{ radius: ringRadius(count, growth), count }]
  }

  const radii: number[] = []
  const capacities: number[] = []
  let room = 0
  while (room < count) {
    const radius = growth.minRadius + radii.length * growth.orbitGap
    radii.push(radius)
    const capacity = ringCapacity(radius, growth.minChord)
    capacities.push(capacity)
    room += capacity
  }

  // Largest-remainder share of `count` across the orbits, weighted by capacity.
  const exact = capacities.map((capacity) => (count * capacity) / room)
  const counts = exact.map(Math.floor)
  let left = count - counts.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (left <= 0) break
    counts[index] += 1
    left -= 1
  }

  return radii
    .map((radius, index) => ({ radius, count: counts[index] }))
    .filter((orbit) => orbit.count > 0)
}

export type RingPoint = { x: number; y: number; labelAbove: boolean }

export type Ring = {
  points: RingPoint[]
  hub: { x: number; y: number }
  width: number
  height: number
}

/**
 * Places every one of `spokes` around the hub — on one ring where they fit, on
 * concentric orbits where they don't — and measures the box that holds them,
 * labels included. Coordinates come back relative to that box's top-left, so
 * callers can position absolutely without knowing the maths.
 */
export function ringLayout(spokes: number, dims: RingDims, growth: RingGrowth): Ring {
  const points = orbitPlan(spokes, growth).flatMap((orbit, orbitIndex) =>
    Array.from({ length: orbit.count }, (_, index) => {
      // Start at the top and go clockwise; the ring reads like a clock face.
      // Every other orbit is offset by half a step so its spokes sit in the gaps
      // of the one inside it, rather than hiding directly behind them.
      const step = (Math.PI * 2) / orbit.count
      const angle = index * step - Math.PI / 2 + (orbitIndex % 2 ? step / 2 : 0)
      return {
        x: Math.cos(angle) * orbit.radius,
        y: Math.sin(angle) * orbit.radius,
        // Labels go on the outer side of the ring, so they never sit on top of
        // the connector coming in from the hub.
        labelAbove: Math.sin(angle) < -0.35,
      }
    }),
  )

  // Size the box to what is actually drawn rather than to the full circle —
  // otherwise a one-spoke ring leaves most of the box empty.
  const xs = [-dims.hub / 2, dims.hub / 2]
  const ys = [-dims.hub / 2, dims.hub / 2]
  for (const point of points) {
    // Labels are wider than the node, so they drive the horizontal bounds.
    xs.push(point.x - dims.labelW / 2, point.x + dims.labelW / 2)
    ys.push(
      point.y - dims.node / 2 - (point.labelAbove ? dims.label : 0),
      point.y + dims.node / 2 + (point.labelAbove ? 0 : dims.label),
    )
  }

  const minX = Math.min(...xs) - dims.pad
  const minY = Math.min(...ys) - dims.pad
  return {
    points: points.map((point) => ({
      x: point.x - minX,
      y: point.y - minY,
      labelAbove: point.labelAbove,
    })),
    hub: { x: -minX, y: -minY },
    width: Math.max(...xs) + dims.pad - minX,
    height: Math.max(...ys) + dims.pad - minY,
  }
}

/** Trim a hub→node line back to both circles' edges, so it never runs under
    a node or its label. */
export function connector(
  hub: { x: number; y: number },
  node: { x: number; y: number },
  dims: RingDims,
) {
  const dx = node.x - hub.x
  const dy = node.y - hub.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  return {
    x1: hub.x + ux * (dims.hub / 2),
    y1: hub.y + uy * (dims.hub / 2),
    x2: node.x - ux * (dims.node / 2),
    y2: node.y - uy * (dims.node / 2),
  }
}
