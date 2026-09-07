import Link from 'next/link';
import { BookOpen, PenTool, ArrowRight } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="inline-flex p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600 dark:text-indigo-400">
          <PenTool className="w-10 h-10" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
          Novel Studio
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-300">
          A dedicated novel-writing workspace featuring Word-accurate A5 layout, Thai/English typography, private draft branching, and snapshot publishing.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <Link
            href="/studio"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md transition-colors"
          >
            Enter Studio <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/read"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <BookOpen className="w-4 h-4" /> Public Reader
          </Link>
        </div>
      </div>
    </main>
  );
}
