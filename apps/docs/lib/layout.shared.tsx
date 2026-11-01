import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      url: '/docs',
      title: (
        <>
          <img alt="Anumat" className="h-6 w-auto dark:hidden" height={24} src="/logo.svg" width={94} />
          <img alt="Anumat" className="hidden h-6 w-auto dark:block" height={24} src="/logo-dark.svg" width={94} />
        </>
      ),
    },
  };
}
