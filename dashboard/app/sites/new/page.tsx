import { NewSiteForm } from '@/components/new-site-form';

export default function NewSitePage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">새 현장 등록</h1>
      <NewSiteForm />
    </main>
  );
}
