import { cloneElement, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'

type Child = ReactElement<{ className?: string; style?: CSSProperties }>

/**
 * Fades its one child in when it appears and out when it goes: when the child
 * turns into null, the last one stays on screen for `ms` while it fades.
 */
export function Presence({ children, ms = 320 }: { children: Child | null | false | undefined; ms?: number }) {
  const present = isValidElement(children)
  const last = useRef<Child | null>(null)
  const [, setGone] = useState(0)
  if (present) last.current = children

  useEffect(() => {
    if (present || !last.current) return
    const t = setTimeout(() => {
      last.current = null
      setGone((n) => n + 1)
    }, ms)
    return () => clearTimeout(t)
  }, [present, ms])

  const el = present ? children : last.current
  if (!el) return null
  return cloneElement(el, {
    className: [el.props.className, 'presence', present ? '' : 'presence-out'].filter(Boolean).join(' '),
    // A variable, not animation-duration: an element that adds its own animation
    // after the fade (the climb warning's pulse) keeps that one's duration.
    style: { ...el.props.style, '--presence-ms': `${ms}ms` } as CSSProperties,
  })
}
