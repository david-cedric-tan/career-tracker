import { cx, initials } from '../../lib/format'

const SIZES = {
  xs: 'size-7 text-[11px]',
  sm: 'size-8 text-[12px]',
  md: 'size-10 text-[13px]',
  lg: 'size-14 text-base',
  xl: 'size-20 text-xl',
} as const

/**
 * A picture with an initials fallback.
 *
 * The fallback is not decorative — most contacts will never have a photo, so
 * initials have to read as a deliberate state rather than a broken image.
 *
 * `shape="circle"` (the default) is a person: a face reads naturally in a
 * circle, and a cropped `object-cover` fill is fine — a person's photo is
 * already roughly square. `shape="square"` is for a company logo instead: a
 * circle crops a wordmark's corners off, so this gets rounded corners over
 * its own natural aspect ratio and `object-contain` rather than a forced
 * crop.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'circle',
  className,
}: {
  name: string
  src?: string | null
  size?: keyof typeof SIZES
  shape?: 'circle' | 'square'
  className?: string
}) {
  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center overflow-hidden',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        'bg-brand-soft font-semibold text-brand-strong ring-1 ring-line',
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={cx('size-full', shape === 'circle' ? 'object-cover' : 'object-contain p-1.5')}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  )
}
