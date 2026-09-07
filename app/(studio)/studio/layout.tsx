'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/firebase/auth';
import { Moon, Sun, BookOpen, PenTool, LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    } else {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    }
  };

  return (
    /*
      A DEFINITE height, not merely a minimum.

      Every studio pane below scrolls internally (`flex-1 overflow-y-auto`), and
      that only behaves deterministically when the column it sits in has a real
      height to divide up. With `min-h-screen` the column's height is auto and
      the browser has to resolve it from its own overflow, which is what let the
      whole document scroll — carrying the editor's formatting toolbar off the
      top of the screen — instead of the manuscript scrolling inside its pane.

      `100dvh` where supported, so a mobile browser's collapsing address bar
      does not leave the pane taller than the visible viewport.
    */
    <div className="h-screen supports-[height:100dvh]:h-[100dvh] flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
      {/* Studio Topbar */}
      <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 flex items-center justify-between z-30">
        <div className="flex items-center gap-3">
          <Link href="/studio" className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <div className="p-1.5 bg-indigo-600 rounded-md text-white">
              <PenTool className="w-4 h-4" />
            </div>
            <span>Novel Studio</span>
          </Link>
          <span className="text-xs text-slate-400 font-mono hidden sm:inline-block">/</span>
          <Link href="/studio" className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hidden sm:inline-block">
            Manuscripts
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {loading ? (
            <div className="w-20 h-8 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-md" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium hidden md:inline-block">
                {user.displayName || user.email}
              </span>
              <Button size="sm" variant="ghost" onClick={() => signOut()} title="Sign out">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={() => signInWithGoogle()}>
              <UserIcon className="w-4 h-4 mr-1.5" /> Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Studio Viewport */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {children}
      </div>
    </div>
  );
}
