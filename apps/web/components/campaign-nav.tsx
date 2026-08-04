'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADVANCED_NAV, TRUNK_NAV } from '../lib/campaign-trunk';

type CampaignNavProps = {
  campaignId: string;
  campaignName?: string;
};

function isActive(pathname: string, href: string, isHub: boolean) {
  if (isHub) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CampaignNav({ campaignId, campaignName }: CampaignNavProps) {
  const pathname = usePathname();

  return (
    <nav className="mb-6 space-y-3" aria-label="Navegacao da campanha">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link className="text-sm text-[#65655f] underline" href="/dashboard/campaigns">
            Campanhas
          </Link>
          {campaignName ? (
            <p className="mt-1 text-sm font-medium text-[#34342f]">{campaignName}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TRUNK_NAV.map((item) => {
          const href = item.href(campaignId);
          const active = isActive(pathname, href, item.id === 'hub');
          return (
            <Link
              key={item.id}
              href={href}
              className={
                active
                  ? 'rounded-md bg-[#24382b] px-3 py-1.5 text-sm font-semibold text-white'
                  : 'rounded-md border border-[#c9c8c0] bg-white px-3 py-1.5 text-sm font-medium text-[#24382b]'
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <details className="rounded-md border border-[#deddd4] bg-white px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-[#65655f]">
          Ferramentas avancadas
        </summary>
        <div className="mt-2 flex flex-wrap gap-2 pb-1">
          {ADVANCED_NAV.map((item) => {
            const href = item.href(campaignId);
            const active = isActive(pathname, href, false);
            return (
              <Link
                key={item.id}
                href={href}
                className={
                  active
                    ? 'rounded-md bg-[#e8e7e1] px-3 py-1.5 text-sm font-medium text-[#151515]'
                    : 'rounded-md px-3 py-1.5 text-sm text-[#65655f] underline'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </details>
    </nav>
  );
}
