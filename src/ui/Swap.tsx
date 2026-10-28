import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

type Layer = { k: string; el: ReactNode }

type Props = {
  /** What the content says; a new value crossfades, the same one stays still. */
  k: string
  children: ReactNode
  ms?: number
  /** 'span' inside inline or table-like places (a <dd>, a chip). */
  as?: 'div' | 'span'
  className?: string
}

/**
 * Crossfades text that changes in place: the old value fades out while the new
 * one fades in on top of it, so there is never a blank frame and nothing
 * flashes. Both sit in one grid cell, so the layout doesn't move.
 */
export function Swap({ k, children, ms = 140, as: Tag = 'div', className }: Props) {
  const [shown, setShown] = useState<Layer>({ k, el: children })
  const [leaving, setLeaving] = useState<Layer | null>(null)

  // A new value: the one on screen becomes the leaving layer. (State set during
  // render, React's pattern for reacting to a changed prop.)
  if (shown.k !== k) {
    setLeaving(shown)
    setShown({ k, el: children })
  }

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setLeaving(null), ms)
    return () => clearTimeout(t)
  }, [leaving, ms])

  return (
    <Tag className={'swap' + (className ? ' ' + className : '')} style={{ '--swap-ms': `${ms}ms` } as CSSProperties}>
      {leaving && (
        <Tag key={`out:${leaving.k}`} className="swap-out" aria-hidden="true">
          {leaving.el}
        </Tag>
      )}
      <Tag key={`in:${k}`} className={leaving ? 'swap-new' : undefined}>
        {children}
      </Tag>
    </Tag>
  )
}
