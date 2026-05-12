"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from './Button';
import { Moon, Sun, Menu, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';

export const Navbar = () => {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark');
  };

  const links = [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/about', label: 'About' },
    { href: '/services', label: 'Services' },
    { href: '/#insights', label: 'Insights' },
    { href: '/testimonial', label: 'Testimonial' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/#contact', label: 'Contact' },
  ];

  const isActive = (href: string) => {
    if (href.includes('#')) return pathname === href.split('#')[0];
    return pathname === href;
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white/80 dark:bg-black/80 backdrop-blur-md border-gray-100 dark:border-zinc-800">
      <div className="container mx-auto flex h-32 items-center px-6 justify-between">
        {/* Logo */}
        <div className="flex items-center">
          <Link href="/" className="mr-8 flex items-center space-x-2">
            <span className="font-bold text-2xl tracking-tight text-emerald-700 dark:text-emerald-500">
              Nexus AgriRise
            </span>
          </Link>
          {/* Desktop links */}
          <div className="hidden lg:flex gap-8">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`text-base transition-colors hover:text-emerald-600 dark:hover:text-emerald-400 ${
                  isActive(link.href)
                    ? 'text-emerald-600 dark:text-emerald-500 font-semibold'
                    : 'text-gray-500 dark:text-gray-400 font-medium'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right side — desktop */}
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-gray-500 dark:text-gray-400"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={22} /> : <Sun size={22} />}
          </button>

          {!loading && (
            <div className="hidden sm:block">
              {user ? (
                <Button variant="secondary" onClick={logout} label="Logout" className="text-base px-6 py-2.5 h-auto rounded-full" />
              ) : (
                <Link href="/login">
                  <Button label="Login / Sign Up" className="text-base px-6 py-2.5 h-auto rounded-full shadow-lg shadow-emerald-500/20" />
                </Link>
              )}
            </div>
          )}

          {/* Hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-gray-600 dark:text-gray-300"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={26} /> : <Menu size={26} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-gray-100 dark:border-zinc-800 bg-white/95 dark:bg-black/95 backdrop-blur-md">
          <div className="container mx-auto px-6 py-4 flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`px-4 py-3 rounded-xl text-base font-medium transition-colors ${
                  isActive(link.href)
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-900'
                }`}
              >
                {link.label}
              </Link>
            ))}

            {/* Auth button in mobile */}
            {!loading && (
              <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 mt-2">
                {user ? (
                  <button
                    onClick={logout}
                    className="w-full px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-colors text-left"
                  >
                    Logout
                  </button>
                ) : (
                  <Link href="/login">
                    <button className="w-full px-4 py-3 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors">
                      Login / Sign Up
                    </button>
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};
