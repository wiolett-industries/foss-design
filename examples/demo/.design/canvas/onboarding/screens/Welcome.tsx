import { ArrowRight, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'

const dots = Array.from({ length: 18 }, (_, i) => i)

export default function Welcome() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-bg px-6 pt-16 pb-10">
      <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
        <div className="grid grid-cols-6 gap-3">
          {dots.map((i) => (
            <motion.span
              key={i}
              className="size-10 rounded-card bg-accent-soft"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0.35, 1, 0.35], scale: 1 }}
              transition={{ delay: i * 0.05, duration: 2.4, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.6 }}
            />
          ))}
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-4">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-caption font-medium text-accent"
        >
          <Sparkles size={14} /> New in 2.0
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 260, damping: 26 }}
          className="text-display font-semibold tracking-tight text-ink"
        >
          Your team's work, in one quiet place.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="text-body text-muted"
        >
          Plans, files and decisions stay together, so nobody has to ask twice.
        </motion.p>
        <motion.a
          href="/sign-up"
          whileTap={{ scale: 0.98 }}
          className="mt-4 flex h-12 items-center justify-center gap-2 rounded-control bg-accent text-body font-medium text-accent-ink no-underline"
        >
          Get started <ArrowRight size={18} />
        </motion.a>
        <button type="button" className="h-11 text-body text-ink-2">
          I already have an account
        </button>
      </div>
    </main>
  )
}
