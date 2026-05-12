"use client";
import React from 'react';
import { Linkedin, Twitter, Instagram, Facebook } from 'lucide-react';
import Link from 'next/link';

export const Footer = () => {
  const socials = [
    { icon: <Linkedin size={20} />, href: "https://linkedin.com", label: "LinkedIn" },
    { icon: <Twitter size={20} />, href: "https://twitter.com", label: "Twitter" },
    { icon: <Instagram size={20} />, href: "https://instagram.com", label: "Instagram" },
    { icon: <Facebook size={20} />, href: "https://facebook.com", label: "Facebook" },
  ];

  return (
    <footer className="py-12 border-t border-gray-100 dark:border-zinc-900 bg-white dark:bg-black transition-colors duration-300">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Copyright */}
          <div className="text-sm text-gray-500 dark:text-zinc-500 order-2 md:order-1">
            <p>&copy; {new Date().getFullYear()} Nexus AgriRise Africa. All rights reserved.</p>
          </div>

          {/* Social Icons */}
          <div className="flex items-center gap-4 order-1 md:order-2">
            {socials.map((social) => (
              <Link
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-zinc-900 text-gray-400 dark:text-zinc-500 hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all duration-300 border border-transparent hover:border-emerald-500/20"
                aria-label={social.label}
              >
                {social.icon}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};
