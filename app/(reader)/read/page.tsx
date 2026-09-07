import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { BookOpen, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PublicBooksPage() {
  let projects: any[] = [];
  try {
    const snap = await adminDb.collection('publicProjects').get();
    projects = snap.docs.map((d) => d.data());
  } catch (err) {
    console.error('Error loading public projects', err);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-8 max-w-4xl mx-auto space-y-8">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-6 text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Public Library</h1>
        <p className="text-sm text-slate-500">Read published novels and released chapters</p>
      </div>

      {projects.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-xl space-y-3">
          <BookOpen className="w-12 h-12 text-slate-400 mx-auto" />
          <p className="text-slate-500">No novels have been published yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {projects.map((p) => (
            <Link
              key={p.slug}
              href={`/read/${p.slug}`}
              className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-indigo-500 transition-colors block group"
            >
              <h2 className="text-xl font-bold group-hover:text-indigo-600 transition-colors">
                {p.title}
              </h2>
              {p.description && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 line-clamp-3">
                  {p.description}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>Published on {new Date(p.publishedAt).toLocaleDateString()}</span>
                <span className="flex items-center gap-1 font-medium text-indigo-600 group-hover:translate-x-1 transition-transform">
                  Read <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
