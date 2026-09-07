import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { BookOpen, FileText, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { projectSlug: string };
}

export default async function PublicProjectOverviewPage({ params }: PageProps) {
  const { projectSlug } = params;

  const projectDoc = await adminDb.collection('publicProjects').doc(projectSlug).get();
  if (!projectDoc.exists) {
    notFound();
  }
  const project = projectDoc.data();

  const [volsSnap, chapsSnap] = await Promise.all([
    adminDb.collection('publicProjects').doc(projectSlug).collection('volumes').orderBy('order', 'asc').get(),
    adminDb.collection('publicProjects').doc(projectSlug).collection('chapters').orderBy('order', 'asc').get(),
  ]);

  const volumes = volsSnap.docs.map((d) => d.data());
  const chapters = chapsSnap.docs.map((d) => d.data());

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-6 md:p-12 max-w-3xl mx-auto space-y-10">
      <div className="text-center space-y-4 border-b border-slate-200 dark:border-slate-800 pb-8">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
          {project?.title}
        </h1>
        {project?.description && (
          <p className="text-base text-slate-600 dark:text-slate-300 max-w-xl mx-auto leading-relaxed">
            {project?.description}
          </p>
        )}
      </div>

      {/* Table of Contents */}
      <div className="space-y-6">
        <h2 className="text-lg font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-600" /> Table of Contents
        </h2>

        {chapters.length === 0 ? (
          <p className="text-slate-500 italic text-sm">No chapters published yet.</p>
        ) : (
          <div className="space-y-6">
            {volumes.length > 0 ? (
              volumes.map((vol) => {
                const volChapters = chapters.filter((c) => c.volumeId === vol.id);
                if (volChapters.length === 0) return null;

                return (
                  <div key={vol.id} className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      {vol.title}
                    </h3>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                      {volChapters.map((chap) => (
                        <Link
                          key={chap.id}
                          href={`/read/${projectSlug}/vol/${chap.id}`}
                          className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                        >
                          <div>
                            <h4 className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                              {chap.chapterNumber ? `Chapter ${chap.chapterNumber}: ` : ''}
                              {chap.title}
                            </h4>
                            {chap.subtitle && <p className="text-xs text-slate-400 mt-0.5">{chap.subtitle}</p>}
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                {chapters.map((chap) => (
                  <Link
                    key={chap.id}
                    href={`/read/${projectSlug}/vol/${chap.id}`}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                  >
                    <div>
                      <h4 className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                        {chap.chapterNumber ? `Chapter ${chap.chapterNumber}: ` : ''}
                        {chap.title}
                      </h4>
                      {chap.subtitle && <p className="text-xs text-slate-400 mt-0.5">{chap.subtitle}</p>}
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
