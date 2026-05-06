'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAccount } from 'wagmi';
import { isAddress } from 'viem';

export default function AirdropPage() {
  const { address } = useAccount();
  const [form, setForm] = useState({ 
    wallet: address || '', 
    twitter: '', 
    telegram: '' 
  });
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAddress(form.wallet)) {
      alert('Please enter a valid EVM address (0x...)');
      return;
    }
    alert('Form submitted! 🚀');
  };

  const faqs = [
    { q: 'When will tokens be distributed?', a: '20 days after airdrop ends.' },
    { q: 'Can I participate more than once?', a: 'No, one entry per person.' },
    { q: 'Can I sell tokens immediately?', a: 'Yes, once listed on exchanges.' },
  ];

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <motion.h1
        className="text-3xl md:text-5xl font-bold text-center text-teal-400"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        FGS1 Airdrop
      </motion.h1>

      <motion.p
        className="mt-6 text-center text-lg text-zinc-300"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        Join the FGS1 airdrop campaign!
      </motion.p>

      <div className="my-8 border-t border-zinc-800" />

      <section>
        <h2 className="text-2xl font-semibold text-teal-300 mb-4">How to Participate</h2>
        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>Create an EVM wallet (MetaMask, etc.).</li>
          <li>Connect your wallet or enter address below.</li>
          <li>Complete tasks on X and Telegram.</li>
        </ol>
      </section>

      <div className="my-8 border-t border-zinc-800" />

      <section>
        <h2 className="text-2xl font-semibold text-teal-300 mb-4">Register</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            name="wallet"
            placeholder="EVM Wallet Address (0x...) *"
            value={form.wallet}
            onChange={(e) => setForm({ ...form, wallet: e.target.value })}
            className="w-full p-3 rounded-lg bg-zinc-900 text-white border border-zinc-700"
            required
          />
          <input
            type="text"
            name="twitter"
            placeholder="Twitter Username"
            value={form.twitter}
            onChange={(e) => setForm({ ...form, twitter: e.target.value })}
            className="w-full p-3 rounded-lg bg-zinc-900 text-white border border-zinc-700"
          />
          <input
            type="text"
            name="telegram"
            placeholder="Telegram Username *"
            value={form.telegram}
            onChange={(e) => setForm({ ...form, telegram: e.target.value })}
            className="w-full p-3 rounded-lg bg-zinc-900 text-white border border-zinc-700"
            required
          />
          <button
            type="submit"
            className="w-full bg-teal-500 hover:bg-teal-400 text-black font-semibold py-3 rounded-lg transition"
          >
            🚀 Submit
          </button>
        </form>
      </section>

      <div className="my-8 border-t border-zinc-800" />

      <section>
        <h2 className="text-2xl font-semibold text-teal-300 mb-6">FAQ</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-zinc-900 p-4 rounded-lg border border-zinc-800">
              <button
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                className="w-full text-left font-medium text-teal-400"
              >
                {faq.q}
              </button>
              {faqOpen === i && (
                <p className="mt-2 text-zinc-300">{faq.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
