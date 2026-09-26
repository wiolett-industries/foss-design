/**
 * @title Toast
 * @group Feedback
 * @status beta
 * @description Confirms an action that happened out of view. Never for errors that need a decision.
 */
import { Toast } from '@system/components/toast'

export default function ToastSpecimen() {
  return (
    <div className="flex flex-col gap-3 p-8">
      <Toast title="Manifest uploaded" text="HB-2291 · 48 containers" />
      <Toast title="Route saved" />
    </div>
  )
}
