import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Campanha360 AI',
  description: 'SaaS multi-campanha para relacionamento eleitoral com IA.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
