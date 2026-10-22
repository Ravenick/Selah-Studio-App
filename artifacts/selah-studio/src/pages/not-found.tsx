import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="studio-not-found">
      <div className="studio-not-found-card">
        <span className="studio-not-found-mark"><Compass aria-hidden="true" size={21} /></span>
        <p className="studio-not-found-eyebrow">SELAH STUDIO</p>
        <h1>We can’t find that page.</h1>
        <p className="studio-not-found-copy">The address may have changed, or the page may no longer be here.</p>
        <Link className="studio-not-found-link" href="/studio">
          <ArrowLeft aria-hidden="true" size={16} /> Return to the studio
        </Link>
        <span className="studio-not-found-code">ERROR 404</span>
      </div>
    </main>
  );
}
