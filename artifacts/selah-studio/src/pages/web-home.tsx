import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';

// Web-only entry page. Tauri selects Studio directly in App.tsx.
export default function WebHome() {
  return (
    <main className="landing-gateway">
      <div className="landing-gateway-glow" aria-hidden="true" />
      <div className="landing-gateway-content">
        <img className="landing-gateway-logo" src="/selah-logo.png" alt="" />
        <p className="landing-gateway-eyebrow">WORSHIP PRESENTATION, WITH ROOM TO BREATHE</p>
        <h1>Make space<br /><span>for what matters.</span></h1>
        <p className="landing-gateway-copy">
          Prepare scripture, songs, sermons, and media in one calm workspace.
        </p>
        <Link className="landing-gateway-button" href="/studio">
          Open Selah Studio <ArrowRight aria-hidden="true" size={17} />
        </Link>
        <span className="landing-gateway-footnote">SELAH STUDIO · BUILT FOR WORSHIP TEAMS</span>
      </div>
    </main>
  );
}
