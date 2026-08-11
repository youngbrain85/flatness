import Link from 'next/link';

export function EmptyState({ message, actionHref, actionLabel }: {
  message: string; actionHref: string; actionLabel: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-white p-8 text-center">
      <p className="text-sm text-zinc-600">{message}</p>
      <Link href={actionHref}
        className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
        {actionLabel}
      </Link>
    </div>
  );
}
