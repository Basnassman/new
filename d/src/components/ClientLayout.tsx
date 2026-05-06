import { ReactNode } from 'react';
import Header from './Header';
import Footer from './Footer';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-white">
      <Header />
      <main className="flex-grow pt-14">
        {children}
      </main>
      <Footer />
    </div>
  );
}
