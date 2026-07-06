export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-6">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#151515]">Entrar</h1>
        <form className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">E-mail</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Senha</span>
            <input className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2" type="password" />
          </label>
          <button className="w-full rounded-md bg-[#24382b] px-4 py-2 font-semibold text-white" type="button">
            Acessar
          </button>
        </form>
      </section>
    </main>
  );
}
