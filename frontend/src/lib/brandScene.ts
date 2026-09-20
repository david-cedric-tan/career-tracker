import { useEffect, useState } from 'react'

/** The moods the about screen (and the sidebar mark) can be in. */
export const SCENES = {
  windy: { label: 'Windy', track: '/windy.mp3', icon: 'cloudSnow' },
  nature: { label: 'Nature', track: '/nature.mp3', icon: 'sun' },
  // Takes its colours from whatever theme the app is set to rather than
  // shipping its own, so the about screen matches the rest of the app instead
  // of being the one place that's always slate-blue or forest-green. Silent
  // by design.
  theme: { label: 'Theme', track: null, icon: 'sparkles' },
  // Has its own record on the about screen, but hovering the logo plays the
  // nature loop — the Lotso track is a song, not ambience. Also reachable by
  // typing a certain word into Talk to a Dev.
  lotso: { label: 'Lotso', track: '/lotso.mp3', hoverTrack: '/nature.mp3', icon: 'bear' },
} as const

export type Scene = keyof typeof SCENES

/** What the sidebar logo plays on hover for a scene, if anything. */
export function hoverTrackFor(scene: Scene): string | null {
  const entry = SCENES[scene] as { track: string | null; hoverTrack?: string }
  return entry.hoverTrack ?? entry.track
}

const SCENE_KEY = 'career-tracker:brand-scene'
const SCENE_EVENT = 'brand-scene-change'

export function readScene(): Scene {
  try {
    const saved = localStorage.getItem(SCENE_KEY)
    return saved && saved in SCENES ? (saved as Scene) : 'windy'
  } catch {
    return 'windy'
  }
}

export function writeScene(scene: Scene) {
  try {
    localStorage.setItem(SCENE_KEY, scene)
  } catch {
    // The choice still holds for this visit.
  }
  // The sidebar and the about screen are separate trees, so a plain setState
  // in one can't reach the other — switching mood has to repaint the logo
  // straight away, not on the next reload.
  window.dispatchEvent(new Event(SCENE_EVENT))
}

/** The saved mood, kept in step across every component that draws it. */
export function useBrandScene(): Scene {
  const [scene, setScene] = useState<Scene>(readScene)

  useEffect(() => {
    const sync = () => setScene(readScene())
    window.addEventListener(SCENE_EVENT, sync)
    // `storage` only fires in *other* tabs, so it covers a second window.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SCENE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return scene
}
