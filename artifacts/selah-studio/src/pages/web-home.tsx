import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowRight, AudioLines, BookOpen, Check, Download, Github, Mic2, MonitorPlay, Music2, Palette, Sparkles, Youtube } from 'lucide-react';
import { Link } from 'wouter';
import tauriConfig from '../../src-tauri/tauri.conf.json';
import '@/landing.css';

const appVersion = tauriConfig.version;

const features = [
  {
    icon: Mic2,
    eyebrow: 'SPEAK · FIND · PRESENT',
    title: 'A reference, found in a breath.',
    copy: 'Speak a Bible reference and move straight into the passage. KJV scripture lookup stays available offline; other speech recognition depends on your browser or connection.',
  },
  {
    icon: Youtube,
    eyebrow: 'LIVE SERVICE',
    title: 'Bring your stream into the room.',
    copy: 'Use a YouTube live URL in your workspace and keep the service under your control from the studio.',
  },
  {
    icon: Palette,
    eyebrow: 'YOUR VISUAL WORLD',
    title: 'Set a scene that feels like yours.',
    copy: 'Choose from themes, motion backgrounds, and stills, then bring your own loops and images. Discover more through curated background sources in the picker.',
  },
  {
    icon: Music2,
    eyebrow: 'SMART SONG WORKSHOP',
    title: 'Shape the song as it will appear.',
    copy: 'Choose the chorus, reorder sections, and let automatic verse markers keep every lyric slide in sequence.',
  },
  {
    icon: MonitorPlay,
    eyebrow: 'ONE WORKSPACE',
    title: 'Prepare with intention. Present with peace.',
    copy: 'Keep scripture, songs, sermons, media, and live output within reach throughout the service.',
  },
];

const windowsDownloadUrl = 'https://github.com/Ravenick/Selah-Studio-App/releases/latest';

export default function WebHome() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const revealItems = document.querySelectorAll<HTMLElement>('.landing-reveal, .landing-feature');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -36px 0px' });

    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  function moveStage(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    event.currentTarget.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
    event.currentTarget.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
  }

  function resetStage(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty('--tilt-x', '0deg');
    event.currentTarget.style.setProperty('--tilt-y', '0deg');
  }

  return (
    <main className="landing">
      <div className="landing-canvas" aria-hidden="true">
        <div className="landing-grid" />
        <div className="landing-orb landing-orb--teal" />
        <div className="landing-orb landing-orb--gold" />
      </div>

      <div className="landing-shell">
        <header className="landing-nav">
          <a className="landing-brand" href="#top" aria-label="Selah Studio home">
            <img src="/selah-logo.png" alt="" />
            <span>Selah Studio</span>
          </a>
          <span className="landing-nav-version">VERSION {appVersion}</span>
        </header>

        <section className="landing-hero" id="top">
          <div className="landing-hero-inner">
            <p className="landing-eyebrow landing-reveal">A QUIETER KIND OF CONTROL ROOM</p>
            <h1 className="landing-title landing-reveal">
              Make room<br />
              <span>for the moment.</span>
            </h1>
            <p className="landing-lede landing-reveal">
              Scripture, songs, sermons, and the stillness between them—held in one thoughtful space for worship teams.
            </p>
            <div className="landing-hero-actions landing-reveal">
              <Link className="landing-btn-primary" href="/studio">
                Enter Selah Studio <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <a className="landing-btn-download" href={windowsDownloadUrl} target="_blank" rel="noreferrer">
                <Download aria-hidden="true" size={16} /> Download for Windows <span>{appVersion}</span>
              </a>
            </div>

            <div
              ref={stageRef}
              className="landing-stage landing-reveal"
              onPointerMove={moveStage}
              onPointerLeave={resetStage}
              aria-label="A preview of the Selah Studio presentation workspace"
            >
              <div className="landing-float-card landing-float-card--main">
                <div className="landing-preview-topline">
                  <span className="landing-live-dot" />
                  <span>MAIN SANCTUARY</span>
                  <span className="landing-preview-live">LIVE PREVIEW</span>
                </div>
                <div className="landing-scripture-preview">
                  <span className="landing-preview-reference">PSALM 46:10</span>
                  <p>Be still, and know<br />that I am God.</p>
                  <span className="landing-preview-version">KING JAMES VERSION</span>
                </div>
                <div className="landing-preview-controls">
                  <span><span className="landing-control-key">01</span> Scripture</span>
                  <span><span className="landing-control-key">02</span> Song</span>
                  <span><span className="landing-control-key">03</span> Sermon</span>
                </div>
              </div>
              <div className="landing-float-card landing-float-card--left">
                <strong><Music2 size={12} /> SERVICE DECK</strong>
                <p>Worship set<br />Message · Response</p>
                <span className="landing-card-progress"><i /></span>
              </div>
              <div className="landing-float-card landing-float-card--right">
                <strong><AudioLines size={12} /> READY WHEN YOU ARE</strong>
                <p>Every element in its place.</p>
                <span className="landing-card-check"><Check size={12} /> Presentation ready</span>
              </div>
            </div>

            <a className="landing-scroll-cue" href="#the-workspace">
              <span>TAKE A CLOSER LOOK</span><ArrowDown aria-hidden="true" size={13} />
            </a>
          </div>
        </section>

        <section className="landing-section" id="the-workspace" aria-labelledby="landing-section-title">
          <div className="landing-section-heading landing-reveal">
            <p className="landing-eyebrow">WHAT'S INSIDE {appVersion}</p>
            <h2 id="landing-section-title">A little less scrambling.<br /><span>A lot more presence.</span></h2>
            <p>The tools that help your team prepare with care, then stay close to the moment when it matters.</p>
          </div>
          <div className="landing-features">
            {features.map(({ icon: Icon, eyebrow, title, copy }, index) => (
              <article className="landing-feature" key={eyebrow} style={{ transitionDelay: `${index * 100}ms` }}>
                <span className="landing-feature-icon"><Icon aria-hidden="true" size={17} /></span>
                <span className="landing-feature-eyebrow">{eyebrow}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="landing-footer">
          <div className="landing-raven-badge">
            <Sparkles aria-hidden="true" size={14} />
            <span>Built by Raven</span>
            <a href="https://github.com/Ravenick" target="_blank" rel="noreferrer">GitHub <Github aria-hidden="true" size={12} /></a>
            <a href="https://ravenick.vercel.app" target="_blank" rel="noreferrer">Portfolio <ArrowRight aria-hidden="true" size={12} /></a>
          </div>
          <span className="landing-footer-note">Selah Studio <span aria-hidden="true">·</span> Version {appVersion}</span>
        </footer>
      </div>
    </main>
  );
}
