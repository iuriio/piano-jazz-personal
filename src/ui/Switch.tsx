import * as RS from '@radix-ui/react-switch'

type Props = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

/** An on/off toggle; put it inside a <label> and the label's text toggles it too. */
export function Switch({ checked, onCheckedChange, disabled, ...rest }: Props) {
  return (
    <RS.Root
      className="ui-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      // A clicked switch keeps no focus, so Space and the note keys reach the stage.
      onPointerUp={(e) => e.currentTarget.blur()}
      {...rest}
    >
      <RS.Thumb className="ui-switch-thumb" />
    </RS.Root>
  )
}
