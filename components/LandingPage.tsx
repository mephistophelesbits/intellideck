'use client';

import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';

export default function LandingPage() {
  const { t } = useTranslation();
  useEffect(() => {
    // Scroll animations
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));

    // Carousel logic
    const track = document.getElementById('carouselTrack');
    const dots = document.querySelectorAll('.carousel-dot');
    const label = document.getElementById('carouselLabel');
    const labels = ['Cyberpunk Theme', 'Warm Amber Theme', 'Matrix Theme'];
    let current = 0;
    let autoplayInterval: NodeJS.Timeout;

    function goToSlide(index: number) {
      current = index;
      if (track) track.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
      if (label) label.textContent = labels[current];
    }

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const indexStr = (dot as HTMLElement).dataset.index;
        if (indexStr !== undefined) {
          goToSlide(parseInt(indexStr));
          resetAutoplay();
        }
      });
    });

    function autoplay() {
      goToSlide((current + 1) % 3);
    }

    function resetAutoplay() {
      clearInterval(autoplayInterval);
      autoplayInterval = setInterval(autoplay, 4000);
    }

    autoplayInterval = setInterval(autoplay, 4000);

    // Smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href');
        if (targetId) {
          const target = document.querySelector(targetId);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });

    // Dark mode initialization
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }

    return () => {
      clearInterval(autoplayInterval);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="landing-page">
      <style jsx global>{`
        :root {
          --bg-primary: #f8fafc;
          --bg-secondary: #f1f5f9;
          --bg-card: #ffffff;
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --text-muted: #94a3b8;
          --border: rgba(148, 163, 184, 0.2);
          --accent: #3b82f6;
          --accent-glow: rgba(59, 130, 246, 0.3);
          --green: #10b981;
          --green-glow: rgba(16, 185, 129, 0.2);
          --glass-bg: rgba(255, 255, 255, 0.7);
          --glass-border: rgba(255, 255, 255, 0.3);
          --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.08);
          --shadow-xl: 0 32px 64px -16px rgba(0, 0, 0, 0.12);
          --gradient-hero: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
        }

        .dark {
          --bg-primary: #0b0f1a;
          --bg-secondary: #111827;
          --bg-card: #1e293b;
          --text-primary: #f1f5f9;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --border: rgba(148, 163, 184, 0.1);
          --glass-bg: rgba(15, 23, 42, 0.8);
          --glass-border: rgba(51, 65, 85, 0.5);
          --shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
          --shadow-xl: 0 32px 64px -16px rgba(0, 0, 0, 0.5);
          --gradient-hero: linear-gradient(180deg, #0b0f1a 0%, #111827 100%);
        }

        .landing-page {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: var(--bg-primary);
          color: var(--text-primary);
          transition: background 0.4s ease, color 0.4s ease;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .animate-on-scroll {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .animate-on-scroll.visible {
          opacity: 1;
          transform: translateY(0);
        }

        nav {
          position: fixed;
          top: 0;
          width: 100%;
          z-index: 100;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          background: var(--glass-bg);
          border-bottom: 1px solid var(--border);
          transition: background 0.4s ease;
        }

        .nav-inner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 64px;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
        }

        .dark-logo { display: block; }
        .light-logo { display: none; }
        html.dark .dark-logo { display: block; }
        html.dark .light-logo { display: none; }
        html:not(.dark) .dark-logo { display: none; }
        html:not(.dark) .light-logo { display: block; }

        .logo-text span {
          color: var(--accent);
        }

        .logo-badge {
          display: none;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 700;
          background: var(--bg-secondary);
          color: var(--text-muted);
          border: 1px solid var(--border);
          letter-spacing: 0.1em;
        }

        @media (min-width: 640px) {
          .logo-badge { display: inline-block; }
        }

        .nav-links {
          display: none;
          align-items: center;
          gap: 32px;
        }

        @media (min-width: 768px) {
          .nav-links { display: flex; }
        }

        .nav-links a {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          text-decoration: none;
          transition: color 0.2s;
        }

        .nav-links a:hover {
          color: var(--accent);
        }

        .theme-toggle {
          background: none;
          border: none;
          cursor: pointer;
          padding: 8px;
          border-radius: 50%;
          color: var(--text-secondary);
          transition: background 0.2s, color 0.2s;
        }

        .theme-toggle:hover {
          background: var(--bg-secondary);
          color: var(--accent);
        }

        .dark .theme-toggle .light-icon { display: block; }
        .dark .theme-toggle .dark-icon { display: none; }
        .theme-toggle .light-icon { display: none; }
        .theme-toggle .dark-icon { display: block; }

        .nav-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 24px;
          background: var(--accent);
          color: #fff;
          border-radius: 100px;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.3s;
          box-shadow: 0 4px 12px var(--accent-glow);
        }

        .hero {
          position: relative;
          padding: 140px 0 80px;
          background: var(--gradient-hero);
          overflow: hidden;
        }

        .hero::before {
          content: '';
          position: absolute;
          top: -20%;
          left: -10%;
          width: 50%;
          height: 60%;
          border-radius: 50%;
          background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
          filter: blur(80px);
          pointer-events: none;
          animation: pulse-glow 6s ease-in-out infinite;
        }

        .hero::after {
          content: '';
          position: absolute;
          bottom: 0;
          right: -15%;
          width: 40%;
          height: 50%;
          border-radius: 50%;
          background: radial-gradient(circle, var(--green-glow) 0%, transparent 70%);
          filter: blur(80px);
          pointer-events: none;
          animation: pulse-glow 8s ease-in-out infinite 2s;
        }

        .hero h1 {
          font-size: clamp(2.5rem, 6vw, 4.5rem);
          font-weight: 900;
          line-height: 1.08;
          letter-spacing: -0.03em;
          margin-bottom: 20px;
          text-align: center;
        }

        .hero h1 .gradient {
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .hero-subtitle {
          max-width: 640px;
          margin: 0 auto 40px;
          font-size: clamp(1rem, 2vw, 1.2rem);
          line-height: 1.7;
          color: var(--text-secondary);
          text-align: center;
        }

        .hero-buttons {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 16px;
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 32px;
          background: var(--accent);
          color: #fff;
          border-radius: 14px;
          font-size: 16px;
          font-weight: 700;
          text-decoration: none;
          box-shadow: 0 8px 24px var(--accent-glow);
          transition: all 0.3s;
        }

        .btn-secondary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 32px;
          background: var(--bg-card);
          color: var(--text-primary);
          border-radius: 14px;
          font-size: 16px;
          font-weight: 700;
          text-decoration: none;
          border: 1px solid var(--border);
          transition: all 0.3s;
        }

        .hero-screenshot {
          position: relative;
          max-width: 1100px;
          margin: 60px auto 0;
        }

        .screenshot-frame {
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--border);
          background: var(--bg-card);
          box-shadow: var(--shadow-xl), 0 0 0 1px var(--border);
          position: relative;
        }

        .screenshot-titlebar {
          height: 40px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
        }

        .titlebar-dots { display: flex; gap: 6px; }
        .titlebar-dots span { width: 10px; height: 10px; border-radius: 50%; }
        .titlebar-dots span:nth-child(1) { background: #f87171; }
        .titlebar-dots span:nth-child(2) { background: #fbbf24; }
        .titlebar-dots span:nth-child(3) { background: #34d399; }

        .titlebar-url {
          padding: 4px 16px;
          border-radius: 6px;
          background: rgba(148, 163, 184, 0.1);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
        }

        .screenshot-carousel { position: relative; overflow: hidden; }
        .carousel-track { display: flex; transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
        .carousel-track img { width: 100%; flex-shrink: 0; display: block; }

        .carousel-dots {
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 8px;
        }

        .carousel-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.4);
          border: none;
          cursor: pointer;
          transition: all 0.3s;
        }

        .carousel-dot.active { background: var(--accent); width: 24px; border-radius: 100px; }

        .privacy-section { padding: 120px 0; background: var(--bg-secondary); border-top: 1px solid var(--border); }
        .privacy-grid { display: grid; grid-template-columns: 1fr; gap: 64px; align-items: center; }
        @media (min-width: 1024px) { .privacy-grid { grid-template-columns: 1fr 1fr; } }

        .features-section { padding: 120px 0; background: var(--bg-primary); }
        .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
        .feature-card { padding: 32px; background: var(--bg-card); border-radius: 20px; border: 1px solid var(--border); transition: all 0.4s; }

        .themes-section { padding: 120px 0; background: var(--bg-secondary); }
        .themes-showcase { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
        .theme-card { border-radius: 20px; overflow: hidden; border: 1px solid var(--border); transition: all 0.4s; }
        .theme-card img { width: 100%; aspect-ratio: 16/10; object-fit: cover; }

        .deploy-section { padding: 120px 0; }
        .deploy-card { background: #0f172a; color: #fff; border-radius: 32px; padding: 64px; }

        footer { padding: 48px 0; background: var(--bg-primary); border-top: 1px solid var(--border); }
      `}</style>

      {/* ===== NAV ===== */}
      <nav>
        <div className="container nav-inner">
          <a className="logo" href="#">
            <img src="/logo-dark.svg" alt="IntelliDeck" style={{ height: '36px', width: 'auto' }} className="dark-logo" />
            <img src="/logo-light.svg" alt="IntelliDeck" style={{ height: '36px', width: 'auto' }} className="light-logo" />
            <span className="logo-badge">{t('landing.selfHosted')}</span>
          </a>
          <div className="nav-links">
            <a href="#features">{t('landing.features')}</a>
            <a href="#privacy">{t('landing.privacy')}</a>
            <a href="#themes">{t('landing.themesNav')}</a>
            <a href="#deploy">{t('landing.selfHost')}</a>
            <button className="theme-toggle" onClick={() => document.documentElement.classList.toggle('dark')}>
              <span className="material-symbols-outlined dark-icon">dark_mode</span>
              <span className="material-symbols-outlined light-icon">light_mode</span>
            </button>
            <a className="nav-cta" href="#deploy">{t('landing.getStarted')}</a>
          </div>
        </div>
      </nav>

      {/* ===== HERO ===== */}
      <section className="hero">
        <div className="container">
          <div className="flex flex-col items-center">
            <div className="hero-badge inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green/10 border border-green/30 text-green text-sm font-semibold mb-6">
              <span className="material-symbols-outlined text-base">shield_lock</span>
              {t('landing.heroPrivateBadge')}
            </div>
            <h1>
              {t('landing.heroTitle1')}<br />
              <span className="gradient">{t('landing.heroTitle2')}</span>
            </h1>
            <p className="hero-subtitle" dangerouslySetInnerHTML={{ __html: t('landing.heroSubtitle') }} />
            <div className="hero-buttons">
              <a className="btn-primary" href="/dashboard" target="_blank" rel="noopener noreferrer">
                {t('landing.livePreview')}
              </a>
              <a className="btn-secondary" href="#deploy">
                {t('landing.deployLocally')}
              </a>
              <a className="btn-secondary" href="https://github.com/mephistophelesbits/intellideck" target="_blank">
                {t('landing.viewSource')}
              </a>
            </div>

            {/* Product Screenshot */}
            <div className="hero-screenshot mt-12 w-full">
              <div className="screenshot-frame">
                <div className="screenshot-titlebar">
                  <div className="titlebar-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <div className="titlebar-url">localhost:3000</div>
                  <span className="material-symbols-outlined text-green">lock</span>
                </div>
                <div className="screenshot-carousel" id="carousel">
                  <div className="carousel-track" id="carouselTrack">
                    <img src="/Screenshot 2026-02-12 at 17.32.12.png" alt="Cyberpunk" />
                    <img src="/Screenshot 2026-02-12 at 17.32.18.png" alt="Amber" />
                    <img src="/Screenshot 2026-02-12 at 17.32.40.png" alt="Matrix" />
                  </div>
                  <div className="carousel-dots" id="carouselDots">
                    <button className="carousel-dot active" data-index="0"></button>
                    <button className="carousel-dot" data-index="1"></button>
                    <button className="carousel-dot" data-index="2"></button>
                  </div>
                  <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur px-3 py-1 rounded text-white text-xs font-semibold" id="carouselLabel">Cyberpunk Theme</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Simple sections for brevity in this component - real version would have full content */}
      <section className="features-section" id="features">
        <div className="container">
          <h2 className="text-3xl font-extrabold text-center mb-12">{t('landing.builtForPowerUsers')}</h2>
          <div className="features-grid">
            <div className="feature-card animate-on-scroll">
              <div className="w-11 h-11 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center mb-5">
                <span className="material-symbols-outlined">lan</span>
              </div>
              <h3 className="font-bold mb-2">{t('landing.networkSovereignty')}</h3>
              <p className="text-sm opacity-80">{t('landing.networkSovereigntyDesc')}</p>
            </div>
            <div className="feature-card animate-on-scroll border-b-2 border-green">
              <div className="w-11 h-11 bg-green-500/10 text-green-500 rounded-xl flex items-center justify-center mb-5">
                <span className="material-symbols-outlined">neurology</span>
              </div>
              <h3 className="font-bold mb-2">{t('landing.localFirstAi')}</h3>
              <p className="text-sm opacity-80">{t('landing.localFirstAiDesc')}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="deploy-section" id="deploy">
        <div className="container">
          <div className="deploy-card">
            <h2 className="text-4xl font-black mb-6">{t('landing.hostItAnywhere')}</h2>
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="flex flex-col gap-6">
                <div className="flex gap-4">
                  <div className="w-11 h-11 bg-white/10 rounded-xl flex items-center justify-center shrink-0 border border-white/20"><span className="material-symbols-outlined">dns</span></div>
                  <div><h4 className="font-bold">{t('landing.homeServer')}</h4><p className="text-sm opacity-60">{t('landing.homeServerDesc')}</p></div>
                </div>
                <a href="https://hub.docker.com/r/kianfong/intellideck" className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold inline-block text-center mt-4">{t('landing.dockerHub')}</a>
              </div>
              <div className="bg-black/40 border border-white/10 rounded-2xl p-6 font-mono text-sm">
                <div className="text-green text-xs font-bold mb-4 uppercase tracking-widest">{t('landing.selfHostCommand')}</div>
                <div className="text-blue-400">docker pull kianfong/intellideck:latest</div>
                <div className="text-teal-400 mt-2">docker run -d -p 3000:3000 \</div>
                <div className="text-teal-400">  -v rss-data:/app/data \</div>
                <div className="text-teal-400">  --name intellideck kianfong/intellideck</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="container py-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 font-black uppercase"><span className="material-symbols-outlined text-green">shield_person</span> RSS DECK</div>
          <div className="flex gap-8 text-xs font-medium opacity-50">
            <a href="https://github.com/mephistophelesbits/intellideck">{t('landing.github')}</a>
            <a href="https://hub.docker.com/r/kianfong/intellideck">{t('landing.docker')}</a>
          </div>
          <div className="text-xs opacity-50">{t('landing.copyright')}</div>
        </div>
      </footer>
    </div>
  );
}
