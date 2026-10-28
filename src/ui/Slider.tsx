import * as RS from '@radix-ui/react-slider'

type Props = {
  value: number
  onValueChange: (value: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
  className?: string
  'aria-label'?: string
  'aria-valuetext'?: string
  title?: string
}

/** A single-thumb slider in the app's look; arrows, Page and Home/End move it. */
export function Slider({ value, onValueChange, min, max, step = 1, disabled, className, title, ...aria }: Props) {
  return (
    <RS.Root
      className={'ui-slider' + (className ? ' ' + className : '')}
      value={[value]}
      onValueChange={([v]) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      title={title}
      // Let go of focus after a drag so the arrows and letters reach the piano.
      onPointerUp={() => (document.activeElement as HTMLElement | null)?.blur()}
    >
      <RS.Track className="ui-slider-track">
        <RS.Range className="ui-slider-range" />
      </RS.Track>
      <RS.Thumb className="ui-slider-thumb" {...aria} />
    </RS.Root>
  )
}
