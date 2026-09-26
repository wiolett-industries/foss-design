import { go } from '@design/runtime'
import { Check } from 'lucide-react'
import { motion } from 'motion/react'

export default function Done() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-8 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        className="flex size-20 items-center justify-center rounded-full bg-ok text-white"
      >
        <motion.span initial={{ pathLength: 0, opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <Check size={40} strokeWidth={3} />
        </motion.span>
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-6 text-title font-semibold text-ink">
        You're in, Dana
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="mt-2 text-body text-muted">
        Your workspace is ready. Invite two teammates to see it come alive.
      </motion.p>
      <button type="button" onClick={() => go('desktop/dashboard')} className="mt-10 h-12 w-full rounded-control bg-accent text-body font-medium text-accent-ink">
        Open workspace
      </button>
      <button type="button" onClick={() => go('welcome')} className="mt-2 h-11 text-body text-ink-2">
        Start over
      </button>
    </main>
  )
}
