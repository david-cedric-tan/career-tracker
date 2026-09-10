import { useAppearance } from '../../appearance/context'
import { useAuth } from '../../auth/context'
import { WALLPAPER_META } from '../../lib/appearance'

/**
 * The blurred backdrop behind everything — independent of theme, so picking
 * a wallpaper never has to switch you into intern mode to see it.
 *
 * Always rendered (it also paints the flat page colour), so switching themes
 * never leaves a frame with no background. The blur and the per-image scrim
 * live in CSS, keyed off `data-wallpaper` on <html>.
 */
export function Wallpaper() {
  const { wallpaper } = useAppearance()
  const { user } = useAuth()
  // 'custom' has no static image — its URL lives on the signed-in user.
  const image =
    wallpaper === 'none'
      ? null
      : wallpaper === 'custom'
        ? user?.custom_wallpaper ?? null
        : WALLPAPER_META[wallpaper].url

  return (
    <div className="wallpaper-layer" aria-hidden="true">
      {image ? (
        <>
          <div
            className="wallpaper-image"
            style={{ backgroundImage: `url(${image})` }}
          />
          <div className="wallpaper-scrim" />
        </>
      ) : null}
    </div>
  )
}
