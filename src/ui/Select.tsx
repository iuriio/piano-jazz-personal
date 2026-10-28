import * as RS from '@radix-ui/react-select'

export type Option = { value: string; label: string; disabled?: boolean }
export type OptionGroup = { group: string; options: Option[] }

type Props = {
  value: string
  onValueChange: (value: string) => void
  options: (Option | OptionGroup)[]
  disabled?: boolean
  className?: string
  'aria-label'?: string
  title?: string
}

function Item({ value, label, disabled }: Option) {
  return (
    <RS.Item className="ui-select-item" value={value} disabled={disabled}>
      <RS.ItemText>{label}</RS.ItemText>
      <RS.ItemIndicator className="ui-select-check">✓</RS.ItemIndicator>
    </RS.Item>
  )
}

/**
 * A dropdown in the app's look, with the keyboard and screen-reader behaviour
 * of a native select. Values are strings; a numeric setting converts at the call.
 */
export function Select({ value, onValueChange, options, disabled, className, title, ...aria }: Props) {
  return (
    <RS.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RS.Trigger className={'ui-select' + (className ? ' ' + className : '')} title={title} {...aria}>
        <RS.Value />
        <RS.Icon className="ui-select-icon">▾</RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          className="ui-select-content"
          position="popper"
          sideOffset={2}
          // Focus goes back to the page, not the trigger: a focused trigger would
          // take the computer keyboard's notes as typeahead and change the value.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <RS.ScrollUpButton className="ui-select-scroll">▴</RS.ScrollUpButton>
          <RS.Viewport className="ui-select-viewport">
            {options.map((o) =>
              'group' in o ? (
                <RS.Group key={o.group}>
                  <RS.Label className="ui-select-label">{o.group}</RS.Label>
                  {o.options.map((i) => (
                    <Item key={i.value} {...i} />
                  ))}
                </RS.Group>
              ) : (
                <Item key={o.value} {...o} />
              ),
            )}
          </RS.Viewport>
          <RS.ScrollDownButton className="ui-select-scroll">▾</RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}
