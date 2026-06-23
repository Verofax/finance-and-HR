export function ComingSoon({ title, phase, description }: { title: string; phase: string; description: string }) {
  return (
    <div>
      <header className="mb-8">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">{phase}</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">{title}</h1>
      </header>
      <div className="section-card text-center py-20">
        <div className="text-5xl mb-4 text-slate-300">⌛</div>
        <h2 className="font-display text-xl font-extrabold text-navy-700 mb-2">Coming soon</h2>
        <p className="text-slate-500 max-w-md mx-auto text-sm">{description}</p>
      </div>
    </div>
  );
}
