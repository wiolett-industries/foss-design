/**
 * @title Badge
 * @group Data display
 * @description Status next to a record. Tone follows meaning, never decoration.
 */
import { Badge } from '@system/components/badge'

export default function BadgeSpecimen() {
  return (
    <div className="flex flex-wrap items-center gap-3 p-8">
      <Badge>Draft</Badge>
      <Badge tone="accent">In transit</Badge>
      <Badge tone="ok">Delivered</Badge>
      <Badge tone="warn">Delayed</Badge>
      <Badge tone="danger">Lost</Badge>
    </div>
  )
}
