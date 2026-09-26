import { motion } from 'motion/react'

export default function Long() {
  return (
    <main className="p-10">
      {Array.from({ length: 30 }, (_, i) => (
        <motion.section key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 rounded-card border border-rule bg-surface p-6">
          Section {i + 1}
        </motion.section>
      ))}
    </main>
  )
}
