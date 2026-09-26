export function Toast({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex w-[340px] animate-fade-in items-start gap-3 rounded-card border border-rule bg-raised p-3 shadow-pop">
      <span className="mt-1 size-2 shrink-0 rounded-pill bg-accent" />
      <div className="flex flex-col gap-0.5">
        <span className="text-body font-semibold">{title}</span>
        {text ? <span className="text-caption text-muted">{text}</span> : null}
      </div>
    </div>
  )
}
