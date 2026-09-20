import { cx } from '../lib/format'

const FUR = '#e8699f'
const FUR_DARK = '#d64f8a'
const CREAM = '#f6e7cc'
const PLUM = '#7a3358'
const INK = '#2b1420'

/**
 * The Lotso scene's weather, in the sense the Windy and Nature scenes have
 * weather. Two drawings: on the square mark the bear stands up behind the
 * logo and waves; on the wide wordmark he's asleep on the grass under a
 * moon. Percent-sized so the sidebar and the credit page share the same
 * markup. Deliberately undocumented outside the About screen.
 */
export function LotsoScene({
  active = true,
  settling = false,
  wide = false,
}: {
  active?: boolean
  settling?: boolean
  wide?: boolean
}) {
  if (!active && !settling) return null
  return (
    <span
      aria-hidden="true"
      className={cx('lotso-scene', wide && 'is-wide', active && 'is-out', settling && 'is-settling')}
    >
      {wide ? <SleepingLotso /> : <WavingLotso />}
    </span>
  )
}

/** Standing, seen from the chest up, one plump paw raised beside the head. */
function WavingLotso() {
  return (
    <svg viewBox="0 0 200 200" overflow="visible" className="lotso-bear">
      {/* body: a round barrel, cream belly */}
      <ellipse cx="100" cy="176" rx="68" ry="50" fill={FUR} />
      <ellipse cx="100" cy="182" rx="42" ry="34" fill={CREAM} />
      {/* left arm hugging the belly, a stubby rounded sausage with a round paw */}
      <ellipse cx="44" cy="166" rx="18" ry="30" fill={FUR} transform="rotate(28 44 166)" />
      <circle cx="58" cy="192" r="14" fill={FUR} />
      <circle cx="58" cy="194" r="7" fill={CREAM} />

      {/* the waving arm: short, thick, rounded — upper arm out from the
          shoulder, forearm up, a big round paw with three finger bumps. All
          fur with a darker edge so it stands off the head. The group pivots
          at the shoulder. Drawn before the head so it rises from behind it. */}
      <g className="lotso-arm">
        {/* one rounded forearm rising straight out of the shoulder, so it
            joins the body rather than floating beside the head */}
        <ellipse cx="160" cy="134" rx="18" ry="34" fill={FUR} stroke={FUR_DARK} strokeWidth="3" transform="rotate(14 160 134)" />
        <circle cx="168" cy="96" r="19" fill={FUR} stroke={FUR_DARK} strokeWidth="3" />
        <circle cx="158" cy="82" r="7" fill={FUR} stroke={FUR_DARK} strokeWidth="2.5" />
        <circle cx="170" cy="78" r="7" fill={FUR} stroke={FUR_DARK} strokeWidth="2.5" />
        <circle cx="182" cy="84" r="7" fill={FUR} stroke={FUR_DARK} strokeWidth="2.5" />
        <ellipse cx="168" cy="100" rx="9" ry="6" fill={CREAM} opacity="0.85" />
      </g>
      {/* ears: small, round, high on the sides */}
      <circle cx="40" cy="48" r="19" fill={FUR} />
      <circle cx="160" cy="48" r="19" fill={FUR} />
      <circle cx="40" cy="50" r="9" fill={CREAM} />
      <circle cx="160" cy="50" r="9" fill={CREAM} />
      {/* head: wide and round, with soft cheeks */}
      <ellipse cx="100" cy="94" rx="74" ry="60" fill={FUR} />
      {/* muzzle: big, cream, puffy — two cheeks and a chin as one shape */}
      <path d="M36 110q4-40 64-40t64 40q0 40-64 42T36 110z" fill={CREAM} />
      {/* nose: a broad plum oval with a flatter top, high on the muzzle */}
      <path d="M66 100q2-20 34-20t34 20q0 16-34 18T66 100z" fill={PLUM} />
      <ellipse cx="86" cy="94" rx="8" ry="3.5" fill="#fff" opacity="0.28" />
      {/* the soft smile line, wide and low */}
      <path d="M70 132q30 14 60 0" stroke={PLUM} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {/* eyes: small, close together, just above the muzzle */}
      <ellipse cx="82" cy="74" rx="7.5" ry="8.5" fill="#fffaf0" />
      <ellipse cx="118" cy="74" rx="7.5" ry="8.5" fill="#fffaf0" />
      <circle cx="83" cy="76" r="4.5" fill={INK} />
      <circle cx="117" cy="76" r="4.5" fill={INK} />
      <circle cx="85" cy="74" r="1.5" fill="#fff" />
      <circle cx="119" cy="74" r="1.5" fill="#fff" />
      {/* brows: thick plum pads resting right over the eyes */}
      <path d="M64 60q16-4 30 6" stroke={PLUM} strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M136 60q-16-4-30 6" stroke={PLUM} strokeWidth="10" fill="none" strokeLinecap="round" />

    </svg>
  )
}

/** Curled up asleep on the grass, a moon above. */
function SleepingLotso() {
  return (
    <>
      <span className="lotso-moon" />
      <span className="lotso-grass" />
      <svg viewBox="0 0 160 80" className="lotso-sleeper">
        {/* body: one plump rounded mound, lying on its side */}
        <path d="M44 72q-4-34 40-40q52-4 68 26q6 14-10 14H52q-8 0-8-0z" fill={FUR} />
        <ellipse cx="96" cy="60" rx="34" ry="12" fill={CREAM} />
        {/* back paw tucked at the end */}
        <circle cx="140" cy="62" r="11" fill={FUR} />
        <ellipse cx="141" cy="63" rx="6" ry="4" fill={CREAM} />
        {/* head resting on the ground, round, ear up */}
        <circle cx="44" cy="24" r="10" fill={FUR} />
        <circle cx="44" cy="25" r="5" fill={CREAM} />
        <circle cx="42" cy="48" r="28" fill={FUR} />
        <circle cx="18" cy="60" r="9" fill={FUR} />
        <circle cx="18" cy="61" r="4.5" fill={CREAM} />
        {/* muzzle turned to the viewer, nose on top */}
        <ellipse cx="36" cy="56" rx="21" ry="15" fill={CREAM} />
        <ellipse cx="34" cy="49" rx="11" ry="6.5" fill={PLUM} />
        <path d="M28 64q8 5 16 0" stroke={PLUM} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* sleeping eyes: two soft arcs under heavy brows */}
        <path d="M44 38q4 3 8 0" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M58 42q4 3 8 0" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M42 31q6-3 12 0" stroke={PLUM} strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M56 35q6-3 12 0" stroke={PLUM} strokeWidth="4.5" fill="none" strokeLinecap="round" />
        {/* front paw tucked under the chin */}
        <circle cx="66" cy="66" r="10" fill={FUR} />
        <ellipse cx="66" cy="68" rx="5" ry="3.5" fill={CREAM} />
        {/* z z */}
        <text className="lotso-z" x="80" y="22" fontSize="12" fontWeight="700" fill={PLUM}>z</text>
        <text className="lotso-z lotso-z-2" x="92" y="12" fontSize="9" fontWeight="700" fill={PLUM}>z</text>
      </svg>
    </>
  )
}
