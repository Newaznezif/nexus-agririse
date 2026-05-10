"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from './Button';

export const Navbar = () => {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  const links = [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '#', label: 'About' },
    { href: '#', label: 'Insights' },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4 justify-between">
        <div className="flex items-center">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <span className="font-bold sm:inline-block">Nexus AgriRise Africa</span>
          </Link>
          <div className="hidden md:flex gap-6">
            {links.map((link) => (
              <Link 
                key={link.label}
                href={link.href}
                className={`transition-colors hover:text-foreground/80 ${pathname === link.href ? 'text-foreground font-semibold' : 'text-foreground/60'}`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!loading && (
            user ? (
              <Button variant="secondary" onClick={logout} label="Logout" className="text-sm px-4 py-1.5 h-auto" />
            ) : (
              <Link href="/login">
                <Button label="Login / Sign Up" className="text-sm px-4 py-1.5 h-auto" />
              </Link>
            )
          )}
        </div>
      </div>
    </nav>
  );
};
