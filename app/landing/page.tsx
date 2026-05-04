'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export default function LandingPage() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    // Check system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDark = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  return (
    <div className={`min-h-screen ${isDark ? 'dark' : ''}`}>
      <div className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors duration-300">
        {/* Navigation */}
        <nav className="fixed top-0 w-full z-50 backdrop-blur-md border-b border-slate-200/50 dark:border-slate-800/50 bg-white/70 dark:bg-slate-900/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-500 text-3xl">rss_feed</span>
                <span className="text-xl font-extrabold tracking-tight uppercase text-slate-900 dark:text-white">
                  RSS<span className="text-blue-500">DECK</span>
                </span>
                <span className="hidden sm:inline-block ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 tracking-wider">
                  SELF-HOSTED
                </span>
              </div>
              <div className="hidden md:flex items-center gap-8 text-sm font-medium">
                <a href="#features" className="hover:text-blue-500 transition-colors text-slate-600 dark:text-slate-300">Features</a>
                <a href="#privacy" className="hover:text-blue-500 transition-colors text-slate-600 dark:text-slate-300">Privacy</a>
                <a href="#deploy" className="hover:text-blue-500 transition-colors text-slate-600 dark:text-slate-300">Self-Host</a>
                <button onClick={toggleDark} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <span className="material-symbols-outlined text-xl">{isDark ? 'light_mode' : 'dark_mode'}</span>
                </button>
                <a href="#deploy" className="bg-blue-500 text-white px-5 py-2.5 rounded-full font-semibold hover:opacity-90 transition-all transform hover:scale-105">
                  Get Started
                </a>
              </div>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden bg-white dark:bg-slate-900">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none -z-10">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px]"></div>
            <div className="absolute bottom-[10%] right-[-10%] w-[30%] h-[30%] bg-emerald-500/10 rounded-full blur-[100px]"></div>
          </div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm font-semibold mb-6">
              <span className="material-symbols-outlined text-base">shield_lock</span>
              100% Private & Self-Hosted
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.1] mb-6 tracking-tight text-slate-900 dark:text-white">
              Own Your Data. <br className="hidden md:block" />{' '}
              <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent">
                Command Your News.
              </span>
            </h1>
            <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-500 dark:text-slate-400 mb-10 leading-relaxed">
              A privacy-first RSS reader designed for power users. Run it on your{' '}
              <span className="text-slate-900 dark:text-slate-200 font-semibold underline decoration-blue-500/30">NAS</span>,{' '}
              <span className="text-slate-900 dark:text-slate-200 font-semibold underline decoration-blue-500/30">Home Server</span>, or{' '}
              <span className="text-slate-900 dark:text-slate-200 font-semibold underline decoration-blue-500/30">local PC</span> with zero-cloud AI summarization.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="#deploy" className="w-full sm:w-auto px-8 py-3 bg-blue-500 text-white rounded-xl font-bold text-lg shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                <span className="material-symbols-outlined">dns</span>
                Deploy Locally
              </a>
              <a href="https://github.com/mephistophelesbits/intellideck" target="_blank" className="w-full sm:w-auto px-8 py-3 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-bold text-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2">
                <span className="material-symbols-outlined">code</span>
                View Source
              </a>
            </div>
            <div className="mt-20 relative max-w-5xl mx-auto">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] overflow-hidden p-2">
                <div className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden aspect-[16/10] relative border border-slate-100 dark:border-slate-800">
                  {/* Mock browser window */}
                  <div className="absolute top-0 w-full h-10 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 justify-between z-10">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
                    </div>
                    <div className="bg-slate-200/50 dark:bg-slate-800 px-4 py-0.5 rounded text-[10px] text-slate-400 font-mono">192.168.1.50:3000/dashboard</div>
                    <div className="w-10 flex justify-end">
                      <span className="material-symbols-outlined text-emerald-500 text-sm">lock</span>
                    </div>
                  </div>
                  {/* Dashboard preview - using screenshot */}
                  <div className="pt-12 px-4 h-full">
                    <Image 
                      src="/Screenshot 2026-02-12 at 17.32.40.png" 
                      alt="IntelliDeck Dashboard" 
                      fill
                      className="object-cover rounded-b-xl"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy Section */}
        <section className="py-24 bg-slate-50 dark:bg-slate-900/50 border-y border-slate-100 dark:border-slate-800 relative overflow-hidden" id="privacy">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.05) 0%, transparent 70%)' }}></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              <div className="lg:w-1/2 space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold uppercase tracking-wider">
                  Privacy Manifesto
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 dark:text-white leading-tight">
                  Your Data Never <br/> Leaves Your Network
                </h2>
                <p className="text-lg text-slate-500 dark:text-slate-400">
                  Unlike traditional readers that store your browsing habits in the cloud, IntelliDeck is an air-tight vault. Your feeds, your articles, and your AI insights remain strictly on your own hardware.
                </p>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                    <span className="font-medium">No external account required</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                    <span className="font-medium">Zero tracking or telemetry</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                    <span className="font-medium">Local AI: No API keys or data sharing</span>
                  </li>
                </ul>
              </div>
              <div className="lg:w-1/2">
                <div className="p-8 md:p-12 bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-2xl relative">
                  <div className="absolute -top-6 -left-6 w-24 h-24 bg-emerald-500/20 rounded-full blur-2xl"></div>
                  <div className="flex flex-col items-center text-center space-y-6">
                    <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-emerald-500 text-4xl">vpn_lock</span>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold">100% Local-First</h3>
                      <p className="text-slate-500 dark:text-slate-400 text-sm">
                        All processing is done via your local CPU/GPU. No data is sent to OpenAI, Anthropic, or any third-party.
                      </p>
                    </div>
                    <div className="w-full h-px bg-slate-100 dark:bg-slate-800"></div>
                    <div className="flex gap-8 justify-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="material-symbols-outlined text-slate-400">dns</span>
                        <span className="text-[10px] font-bold uppercase text-slate-400">Home Server</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="material-symbols-outlined text-blue-500">arrow_forward_ios</span>
                        <span className="text-[10px] font-bold uppercase text-blue-500">Secure</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="material-symbols-outlined text-slate-400">desktop_windows</span>
                        <span className="text-[10px] font-bold uppercase text-slate-400">Browser</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 bg-white dark:bg-slate-900" id="features">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-slate-900 dark:text-white">Built for Privacy Enthusiasts</h2>
              <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">Advanced features that put you in complete control of your information pipeline.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { icon: 'lan', title: 'Network Sovereignty', desc: 'Runs entirely on your LAN. Access via VPN or local IP. You own the hardware, you own the reader.', color: 'blue' },
                { icon: 'neurology', title: 'Local-First AI', desc: 'Leverages Ollama to run LLMs on your server. Instant AI summaries without sending text to the cloud.', color: 'emerald', border: true },
                { icon: 'encrypted', title: 'Self-Managed Database', desc: 'SQLite or PostgreSQL — your data stays in your filesystem. Simple backups, full data portability.', color: 'indigo' },
                { icon: 'article', title: 'Full-Article Scraping', desc: 'Local readability engine extracts content, stripping ads and trackers before you even see them.', color: 'orange' },
                { icon: 'view_column', title: 'Deck-Style Interface', desc: 'Powerful multi-column layout for high-density reading. Skim through hundreds of headlines efficiently.', color: 'pink' },
                { icon: 'devices_other', title: 'Cross-Platform Local', desc: 'Access your local instance from any device on your network via responsive web interface.', color: 'amber' },
              ].map((feature, i) => (
                <div key={i} className={`p-8 bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:shadow-xl transition-all group ${feature.border ? 'border-b-2 border-b-emerald-500' : ''}`}>
                  <div className={`w-10 h-10 bg-${feature.color}-500/5 rounded-lg flex items-center justify-center mb-6 group-hover:bg-${feature.color}-500/10 transition-colors`}>
                    <span className={`material-symbols-outlined text-${feature.color}-500 text-2xl`}>{feature.icon}</span>
                  </div>
                  <h3 className="text-lg font-bold mb-3 text-slate-900 dark:text-white">{feature.title}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Deploy Section */}
        <section className="py-24 bg-white dark:bg-slate-900" id="deploy">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-[#0F172A] text-white rounded-[2rem] p-8 md:p-16 relative overflow-hidden border border-slate-800">
              <div className="relative grid lg:grid-cols-2 gap-16 items-center">
                <div>
                  <h2 className="text-4xl md:text-5xl font-extrabold mb-6 leading-tight">Host It <br/> Anywhere</h2>
                  <p className="text-slate-400 text-lg mb-10 leading-relaxed">
                    Optimized for low-power hardware and standard home lab setups. Whether it's a dedicated NAS or a background task on your PC.
                  </p>
                  <div className="space-y-6">
                    <div className="flex gap-4 items-start">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-500 shrink-0">
                        <span className="material-symbols-outlined">settings_backup_restore</span>
                      </div>
                      <div>
                        <h4 className="font-bold mb-1 text-slate-100">Synology & QNAP</h4>
                        <p className="text-sm text-slate-500">Run as a Docker Container on your NAS with persistent storage volumes.</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-500 shrink-0">
                        <span className="material-symbols-outlined">dns</span>
                      </div>
                      <div>
                        <h4 className="font-bold mb-1 text-slate-100">Home Server / Raspberry Pi</h4>
                        <p className="text-sm text-slate-500">Lightweight image built for ARM and x86 architectures.</p>
                      </div>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-500 shrink-0">
                        <span className="material-symbols-outlined">laptop_mac</span>
                      </div>
                      <div>
                        <h4 className="font-bold mb-1 text-slate-100">Local PC / MacOS</h4>
                        <p className="text-sm text-slate-500">Perfect for local development or as a standalone desktop news app.</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-12 flex flex-wrap gap-4">
                  <button className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-100 transition-colors">
                    <span className="material-symbols-outlined text-lg">folder_zip</span>
                    Docker Compose
                  </button>
                  <button className="bg-slate-800/50 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 border border-slate-700 hover:bg-slate-700 transition-colors">
                    <span className="material-symbols-outlined text-lg">terminal</span>
                    NAS Setup Guide
                  </button>
                </div>
              </div>
              <div className="mt-12 bg-slate-900/50 rounded-2xl p-8 font-mono text-xs border border-slate-800/50 shadow-2xl relative">
                <div className="absolute -top-4 -right-4 bg-emerald-500 text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-lg">LOCAL-FIRST AI READY</div>
                <div className="flex items-center gap-2 mb-6">
                  <span className="text-slate-500 uppercase tracking-widest text-[10px] font-bold">Self-Host Command</span>
                </div>
                <div className="space-y-4">
                  <div className="text-slate-600"># Docker Pull (NAS/Server)</div>
                  <div className="text-blue-400">docker pull kianfong/intellideck:latest</div>
                  <div className="text-slate-600 pt-2"># Run Local Stack (includes Ollama)</div>
                  <div className="text-teal-400">docker-compose up -d</div>
                  <div className="pt-6 text-slate-600"># Network access</div>
                  <div className="text-slate-300">URL: http://localhost:3000</div>
                  <div className="text-slate-300">LAN: http://nas-ip:3000</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tech Stack */}
        <section className="py-20 bg-white dark:bg-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-12">Private Tech Stack</h3>
            <div className="flex flex-wrap justify-center items-center gap-12 opacity-60">
              <span className="text-lg font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="material-symbols-outlined text-xl">memory</span> Ollama (Local AI)
              </span>
              <span className="text-lg font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="material-symbols-outlined text-xl">database</span> SQLite / Postgres
              </span>
              <span className="text-lg font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="material-symbols-outlined text-xl">box</span> Docker
              </span>
              <span className="text-lg font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="material-symbols-outlined text-xl">shield</span> Readability.js
              </span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 bg-white dark:bg-slate-900 border-t border-slate-50 dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-8">
              <div className="flex items-center gap-2 text-emerald-500">
                <span className="material-symbols-outlined text-2xl">shield_person</span>
                <span className="text-lg font-bold tracking-tight uppercase text-slate-900 dark:text-white">RSS DECK</span>
              </div>
              <div className="flex gap-8 text-xs text-slate-500 font-medium">
                <a href="https://github.com/mephistophelesbits/intellideck" className="hover:text-blue-500 transition-colors">GitHub Repo</a>
                <a href="https://hub.docker.com/r/kianfong/intellideck" className="hover:text-blue-500 transition-colors">Docker Hub</a>
              </div>
              <div className="text-xs text-slate-400">
                © 2026 IntelliDeck. Open Source & Privacy Focused.
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
