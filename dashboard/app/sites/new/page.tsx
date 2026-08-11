import { NewSiteForm } from '@/components/new-site-form';
import { PageHeader } from '@/components/ui/page-header';

export default function NewSitePage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <PageHeader crumbs={[{ href: '/', label: '현장' }]} title="새 현장 등록" />
      <NewSiteForm />
    </main>
  );
}
