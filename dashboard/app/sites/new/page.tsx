// 새 현장 등록(아트보드 SiteNew): 브레드크럼 현장 › 새 현장 등록(비링크) + h1 + 폼(컨테이너·버튼은 폼이 그린다).
import { NewSiteForm } from '@/components/new-site-form';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';

export default function NewSitePage() {
  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '새 현장 등록' }]} title="새 현장 등록" />
      <NewSiteForm />
    </main>
  );
}
