import { ReactNode } from 'react';

type ContactSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function ContactSection({
  title,
  description,
  children,
  className = '',
}: ContactSectionProps) {
  return (
    <section className={`rounded-md border border-[#deddd4] bg-white p-4 ${className}`}>
      <div className="mb-4">
        <h3 className="font-medium text-[#24382b]">{title}</h3>
        {description ? <p className="mt-1 text-sm text-[#65655f]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

type CrmPlaceholderProps = {
  title: string;
  description: string;
};

export function CrmPlaceholder({ title, description }: CrmPlaceholderProps) {
  return (
    <ContactSection title={title} description={description}>
      <div className="rounded-md border border-dashed border-[#d7d6cd] bg-[#f7f7f5] px-4 py-6 text-sm text-[#65655f]">
        Area reservada para implementacao futura neste epico.
      </div>
    </ContactSection>
  );
}
