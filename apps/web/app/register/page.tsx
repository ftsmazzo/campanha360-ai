'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, registerUser, setStoredToken } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await registerUser({ name, email, password });
      setStoredToken(result.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a conta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-6">
      <section className="w-full max-w-sm">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#47624f]">Campanha360 AI</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#151515]">Criar conta</h1>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Nome</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">E-mail</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[#34342f]">Senha</span>
            <input
              className="mt-1 w-full rounded-md border border-[#d7d6cd] bg-white px-3 py-2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button
            className="w-full rounded-md bg-[#24382b] px-4 py-2 font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>
        <p className="mt-4 text-sm text-[#65655f]">
          Ja tem conta?{' '}
          <Link className="font-medium text-[#24382b] underline" href="/login">
            Entrar
          </Link>
        </p>
      </section>
    </main>
  );
}
