import { cx, initials } from '../../lib/format'

/**
 * A company's logo as an app-style rounded square.
 *
 * Square rather than circular on purpose: these are brand marks, and a circle
 * crops wordmarks badly. The tinted plate behind it gives a transparent PNG
 * something to sit on so a white-on-transparent logo doesn't vanish in dark
 * mode, and the padding keeps a wide mark from touching the edges.
 */
export function CompanyMark({
  name,
  logo,
  size = 40,
  className,
}: {
  name: string
  logo?: string | null
  size?: number
  className?: string
}) {
  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center overflow-hidden rounded-xl border border-line',
        'bg-surface-2 shadow-sm',
        className,
      )}
      style={{ width: size, height: size }}
      title={name}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-contain p-1.5"
        />
      ) : (
        <span
          aria-hidden="true"
          className="font-semibold text-brand-strong"
          style={{ fontSize: size * 0.34 }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  )
}
