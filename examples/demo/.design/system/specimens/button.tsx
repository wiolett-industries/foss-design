/**
 * @title Button
 * @group Actions
 * @description One primary action per view, secondary for the rest, ghost inside toolbars.
 * @source ../components/button.tsx
 */
import { Button } from '@system/components/button'

export default function ButtonSpecimen() {
  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary">Save changes</Button>
        <Button>Cancel</Button>
        <Button kind="ghost">More</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" disabled>
          Save changes
        </Button>
        <Button disabled>Cancel</Button>
      </div>
    </div>
  )
}
