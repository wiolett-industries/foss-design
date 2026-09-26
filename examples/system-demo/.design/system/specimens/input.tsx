/**
 * @title Text field
 * @group Forms
 * @description Label above, hint on the right, error below. 36px tall to line up with buttons.
 * @source ../components/input.tsx
 * @source ../components/label.tsx
 */
import { Input } from '@system/components/input'

export default function InputSpecimen() {
  return (
    <div className="grid max-w-[720px] grid-cols-2 gap-6 p-8">
      <Input label="Vessel name" placeholder="MSC Aurora" />
      <Input label="IMO number" hint="7 digits" defaultValue="9811000" />
      <Input label="Port of call" defaultValue="Rotterdam" disabled />
      <Input label="ETA" defaultValue="31/02/2026" error="That date does not exist" />
    </div>
  )
}
