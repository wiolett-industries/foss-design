import { Button } from '@system/components/button'
import { useTheme } from '@design/runtime'

export default function Cart({ count = 0 }: { count?: number }) {
  const theme = useTheme()
  return (
    <main className="min-h-screen bg-bg p-6 text-ink">
      <h1 className="text-title font-semibold">Cart ({count})</h1>
      <p className="text-caption text-muted">theme: {theme}</p>
      <div className="mt-4 flex gap-2">
        <Button kind="primary">Checkout</Button>
      </div>
    </main>
  )
}
