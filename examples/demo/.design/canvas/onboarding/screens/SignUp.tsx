import { AlertCircle, ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

export default function SignUp({ state }: { state?: 'error' }) {
  const [email, setEmail] = useState(state === 'error' ? 'dana@company' : '')
  const [password, setPassword] = useState(state === 'error' ? 'short' : '')
  const [show, setShow] = useState(false)
  const [tried, setTried] = useState(state === 'error')
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
  const passwordOk = password.length >= 8
  const submit = () => {
    setTried(true)
    if (emailOk && passwordOk) history.pushState(null, '', '/verify')
  }
  return (
    <main className="flex min-h-screen flex-col bg-bg px-6 pt-6 pb-10">
      <a href="/" aria-label="Back" className="flex size-11 items-center justify-center rounded-control text-ink-2">
        <ArrowLeft size={20} />
      </a>
      <h1 className="mt-6 text-title font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-body text-muted">Use your work email so your team can find you.</p>
      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink-2">Work email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dana@company.com"
            className={`h-12 rounded-control border bg-surface px-3.5 text-body text-ink outline-none transition focus:border-accent ${tried && !emailOk ? 'border-danger' : 'border-rule-strong'}`}
          />
          <AnimatePresence>
            {tried && !emailOk ? (
              <motion.span initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-1.5 text-caption text-danger">
                <AlertCircle size={14} /> Enter the full address, like name@company.com
              </motion.span>
            ) : null}
          </AnimatePresence>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink-2">Password</span>
          <span className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`h-12 w-full rounded-control border bg-surface px-3.5 pr-12 text-body text-ink outline-none transition focus:border-accent ${tried && !passwordOk ? 'border-danger' : 'border-rule-strong'}`}
            />
            <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-soft">
            <motion.span className="block h-full bg-accent" animate={{ width: `${Math.min(100, (password.length / 12) * 100)}%` }} />
          </span>
          {tried && !passwordOk ? <span className="text-caption text-danger">At least 8 characters</span> : null}
        </label>
        <button type="submit" className="mt-2 h-12 rounded-control bg-accent text-body font-medium text-accent-ink active:opacity-90">
          Continue
        </button>
      </form>
      <p className="mt-auto pt-8 text-center text-caption text-muted">By continuing you accept the [TERMS] and [PRIVACY POLICY].</p>
    </main>
  )
}
