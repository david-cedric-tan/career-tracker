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
  /** Ceiling, past which spokes fold into a "+N" node instead. */
  maxRadius: number
}

/** Growth tuned to a set of dimensions: enough gap to clear the hub and the
    node, and a chord wide enough for the label plus a margin. */
export function growthFor(dims: RingDims, gap = 28): RingGrowth {
  return {
    minRadius: dims.hub / 2 + dims.node / 2 + gap,
    perSpoke: Math.round(gap / 3),
    minChord: dims.labelW + gap,
    maxRadius: dims.labelW * 2 + dims.hub,
  }
}

/** Whichever is larger: the steady growth per spoke, or the radius the
    busiest rings need to keep neighbours from touching. */
export function ringRadius(spokes: number, growth: RingGrowth): number {
  const steady = growth.minRadius + growth.perSpoke * (spokes - 1)
  const spaced = spokes < 2 ? 0 : growth.minChord / (2 * Math.sin(Math.PI / spokes))
  return Math.min(growth.maxRadius, Math.max(steady, spaced))
}

export type RingPoint = { x: number; y: number; labelAbove: boolean }

export type Ring = {
  points: RingPoint[]
  hub: { x: number; y: number }
  width: number
  height: number
}

/**
 * Places `spokes` evenly around the hub and measures the box that holds them,
 * labels included. Coordinates come back relative to that box's top-left, so
 * callers can position absolutely without knowing the maths.
 */
export function ringLayout(spokes: number, radius: number, dims: RingDims): Ring {
  const points = Array.from({ length: spokes }, (_, index) => {
    // Start at the top and go clockwise; the ring reads like a clock face.
    const angle = (index / spokes) * Math.PI * 2 - Math.PI / 2
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      // Labels go on the outer side of the ring, so they never sit on top of
      // the connector coming in from the hub.
      labelAbove: Math.sin(angle) < -0.35,
    }
  })

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
