'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { clearStoredToken } from '../lib/api';

type DashboardShellProps = {
  userName?: string;
  children: ReactNode;
};

export function DashboardShell({ userName, children }: DashboardShellProps) {
  const router = useRouter();

  function handleLogout() {
    clearStoredToken();
    router.push('/login');
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5]">
      <header className="border-b border-[#deddd4] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <Link className="text-xl font-semibold text-[#151515]" href="/dashboard">
              Campanha360 AI
            </Link>
            {userName ? <p className="text-sm text-[#65655f]">Ola, {userName}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            <Link className="text-sm font-medium text-[#24382b] underline" href="/dashboard">
              Organizacoes
            </Link>
            <Link className="text-sm font-medium text-[#24382b] underline" href="/dashboard/campaigns">
              Campanhas
            </Link>
            <button
              className="rounded-md border border-[#c9c8c0] px-4 py-2 text-sm font-medium text-[#24382b]"
              type="button"
              onClick={handleLogout}
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-8">{children}</section>
    </main>
  );
}
