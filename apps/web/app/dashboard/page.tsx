const items = [
  'Campanhas',
  'Eleitores',
  'Segmentos',
  'Inbox',
  'Canais',
  'IA',
  'Compliance',
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f5]">
      <header className="border-b border-[#deddd4] bg-white px-6 py-4">
        <h1 className="text-xl font-semibold text-[#151515]">Campanha360 AI</h1>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-8">
        <h2 className="text-3xl font-semibold text-[#151515]">Painel operacional</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item} className="rounded-md border border-[#deddd4] bg-white p-4">
              <p className="font-medium text-[#24382b]">{item}</p>
              <p className="mt-2 text-sm text-[#65655f]">Modulo planejado para as proximas fases.</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
