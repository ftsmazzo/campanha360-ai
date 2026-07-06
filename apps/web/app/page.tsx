import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] px-6 py-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-center">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#47624f]">
          Campanha360 AI
        </p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-tight text-[#151515]">
          Operacao de campanha, base de eleitores e atendimento em um so lugar.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4a4a44]">
          Plataforma SaaS para organizar contatos, consentimentos, canais,
          conversas e IA assistiva com rastreabilidade desde o primeiro dia.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            className="rounded-md bg-[#24382b] px-5 py-3 text-sm font-semibold text-white"
            href="/login"
          >
            Entrar
          </Link>
          <Link
            className="rounded-md border border-[#c9c8c0] px-5 py-3 text-sm font-semibold text-[#24382b]"
            href="/dashboard"
          >
            Ver painel
          </Link>
        </div>
      </section>
    </main>
  );
}
