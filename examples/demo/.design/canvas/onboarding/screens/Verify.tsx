import { ArrowLeft, MailCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

export default function Verify() {
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [seconds, setSeconds] = useState(30)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const set = (i: number, value: string) => {
    const next = [...code]
    next[i] = value.slice(-1)
    setCode(next)
    if (value && i < 5) refs.current[i + 1]?.focus()
    if (next.every(Boolean)) setTimeout(() => history.pushState(null, '', '/done'), 350)
  }
  return (
    <main className="flex min-h-screen flex-col bg-bg px-6 pt-6 pb-10">
      <a href="/sign-up" aria-label="Back" className="flex size-11 items-center justify-center rounded-control text-ink-2">
        <ArrowLeft size={20} />
      </a>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        className="mt-8 flex size-14 items-center justify-center rounded-card bg-accent-soft text-accent"
      >
        <MailCheck size={26} />
      </motion.div>
      <h1 className="mt-5 text-title font-semibold text-ink">Check your inbox</h1>
      <p className="mt-1 text-body text-muted">We sent a 6-digit code to dana@company.com. Type any digits to continue.</p>
      <div className="mt-8 grid grid-cols-6 gap-2">
        {code.map((digit, i) => (
          <motion.input
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            value={digit}
            inputMode="numeric"
            onChange={(e) => set(i, e.target.value)}
            animate={digit ? { scale: [1, 1.08, 1] } : {}}
            className="h-14 rounded-control border border-rule-strong bg-surface text-center text-title font-semibold text-ink outline-none focus:border-accent"
          />
        ))}
      </div>
      <button type="button" disabled={seconds > 0} onClick={() => setSeconds(30)} className="mt-6 h-11 text-body text-accent disabled:text-muted">
        {seconds > 0 ? `Send a new code in 0:${String(seconds).padStart(2, '0')}` : 'Send a new code'}
      </button>
    </main>
  )
}
