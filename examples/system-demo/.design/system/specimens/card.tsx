/**
 * @title Card
 * @group Layout
 * @description A titled container for one topic. Lifts on hover when the whole card is a link.
 */
import { Badge } from '@system/components/badge'
import { Card } from '@system/components/card'

export default function CardSpecimen() {
  return (
    <div className="grid grid-cols-2 gap-6 p-8">
      <Card title="Shipment HB-2291" meta="Updated 4 min ago">
        <div className="flex items-center justify-between text-body">
          <span className="text-ink-2">Rotterdam → Gdańsk</span>
          <Badge tone="accent">In transit</Badge>
        </div>
      </Card>
      <Card title="Crew" meta="12 people">
        <p className="text-body text-ink-2">Captain M. Varga, first officer L. Okafor.</p>
      </Card>
    </div>
  )
}
