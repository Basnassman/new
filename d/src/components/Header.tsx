'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import ConnectButton from './ConnectButton';

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full bg-zinc-950 border-b border-zinc-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <button onClick={() => setOpen(true)} className="p-2 text-teal-400">
          <Menu size={22} />
        </button>
        <h1 className="text-lg font-bold text-teal-400">💎 FGS1</h1>
        <ConnectButton />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col p-6">
          <button onClick={() => setOpen(false)} className="self-end mb-6 text-teal-400">
            <X size={28} />
          </button>
          <nav className="space-y-6 text-lg text-teal-400">
            <Link href="/" onClick={() => setOpen(false)} className="block hover:text-white">Home</Link>
            <Link href="/buy" onClick={() => setOpen(false)} className="block hover:text-white">Buy</Link>
            <Link href="/airdrop" onClick={() => setOpen(false)} className="block hover:text-white">Airdrop</Link>
            <Link href="/about" onClick={() => setOpen(false)} className="block hover:text-white">About</Link>
            <Link href="/contact" onClick={() => setOpen(false)} className="block hover:text-white">Contact</Link>
            <Link href="/services" onClick={() => setOpen(false)} className="block hover:text-white">Services</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
