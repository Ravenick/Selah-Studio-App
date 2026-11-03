import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, CheckCircle2, Clipboard, Clock3, FileText, LoaderCircle, Monitor, Music2, Radio, RefreshCw, ShieldCheck, Trash2, Wifi, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type SubmissionKind = 'song' | 'sermon' | 'announcement';
type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export type IncomingSubmission = {
  id: string;
  title: string;
  kind: SubmissionKind;
  content: string;
  author: string;
  scriptureReferences: string;
  notes: string;
  senderName: string;
  deviceId?: string;
  submittedAt: number;
  status: SubmissionStatus;
};

type WifiStatus = {
  running: boolean;
  address: string | null;
  expiresAt: number | null;
  connectedDevices: number;
  activeTransfers: number;
  failedSubmissions: number;
  incomingCount: number;
  pendingCount: number;
};

type Props = {
  onApprove: (submission: IncomingSubmission) => Promise<void>;
};

const emptyStatus: WifiStatus = {
  running: false,
  address: null,
  expiresAt: null,
  connectedDevices: 0,
  activeTransfers: 0,
  failedSubmissions: 0,
  incomingCount: 0,
  pendingCount: 0,
};

const typeNames: Record<SubmissionKind, string> = {
  song: 'Song',
  sermon: 'Sermon',
  announcement: 'Announcement',
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp * 1000);
}

export function StudioConnect({ onApprove }: Props) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'connect' | 'incoming'>('connect');
  const [status, setStatus] = useState(emptyStatus);
  const [incoming, setIncoming] = useState<IncomingSubmission[]>([]);
  const [filter, setFilter] = useState<'all' | SubmissionKind>('all');
  const [editing, setEditing] = useState<IncomingSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setStatus(await invoke<WifiStatus>('get_wifi_status'));
    } catch (reason) {
      console.error('Could not read the local Wi-Fi service status.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const refreshIncoming = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setIncoming(await invoke<IncomingSubmission[]>('get_incoming_submissions'));
    } catch (reason) {
      console.error('Could not load incoming submissions.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const updateStatus = async () => {
      try {
        const next = await invoke<WifiStatus>('get_wifi_status');
        if (active) setStatus(next);
      } catch (reason) {
        console.error('Could not refresh the local Wi-Fi status.', reason);
      }
    };
    void updateStatus();
    void refreshIncoming();
    const timer = window.setInterval(() => {
      void updateStatus();
    }, 4000);
    let unlistenSubmission: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    void listen('wifi-submission-received', () => {
      void refreshIncoming();
    }).then((unlisten) => {
      if (active) unlistenSubmission = unlisten;
      else unlisten();
    });
    void listen<string>('wifi-service-error', (event) => {
      if (active) setError(`The local sharing service stopped unexpectedly: ${event.payload}`);
    }).then((unlisten) => {
      if (active) unlistenError = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      unlistenSubmission?.();
      unlistenError?.();
    };
  }, [refreshIncoming]);

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    void refreshIncoming();
  }, [open, refreshIncoming, refreshStatus]);

  const visibleIncoming = useMemo(() => incoming.filter((item) => filter === 'all' || item.kind === filter), [filter, incoming]);
  const pairingToken = useMemo(() => {
    if (!status.address) return '';
    try {
      return new URL(status.address).searchParams.get('token') ?? '';
    } catch {
      return '';
    }
  }, [status.address]);
  const failedCount = incoming.filter((item) => item.status === 'rejected').length;
  const approvedCount = incoming.filter((item) => item.status === 'approved').length;

  async function startSharing() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setStatus(await invoke<WifiStatus>('start_wifi_sharing'));
      setNotice('Wi-Fi sharing is active. The QR code is ready to scan.');
    } catch (reason) {
      console.error('Could not start local Wi-Fi sharing.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    setBusy(true);
    setError('');
    try {
      setStatus(await invoke<WifiStatus>('stop_wifi_sharing'));
      setNotice('Sharing stopped. The previous QR code and pairing token are now invalid.');
    } catch (reason) {
      console.error('Could not stop local Wi-Fi sharing.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshAddress() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await invoke<WifiStatus>('stop_wifi_sharing');
      setStatus(await invoke<WifiStatus>('start_wifi_sharing'));
      setNotice('A fresh local address and pairing code are ready.');
    } catch (reason) {
      console.error('Could not refresh the local Wi-Fi address.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!status.address) return;
    try {
      await navigator.clipboard.writeText(status.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (reason) {
      console.error('Could not copy the Wi-Fi address.', reason);
      setError('Clipboard access was unavailable. Select and copy the connection address manually.');
    }
  }

  async function saveSubmission(updated: IncomingSubmission) {
    setBusy(true);
    setError('');
    try {
      setIncoming(
        await invoke<IncomingSubmission[]>('update_incoming_submission', {
          submission: updated,
        }),
      );
      setEditing(null);
      setNotice('Submission updated and saved on this computer.');
    } catch (reason) {
      console.error('Could not update the incoming submission.', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function setSubmissionStatus(item: IncomingSubmission, nextStatus: SubmissionStatus) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (nextStatus === 'approved') await onApprove(item);
      setIncoming(
        await invoke<IncomingSubmission[]>('update_incoming_submission', {
          submission: { ...item, status: nextStatus },
        }),
      );
      setNotice(
        nextStatus === 'approved'
          ? `“${item.title}” was added to the existing ${item.kind === 'announcement' ? 'sermon' : item.kind} library. Live output was not changed.`
          : nextStatus === 'rejected'
            ? 'Submission rejected and retained in the incoming list.'
            : 'Submission returned to pending review.',
      );
    } catch (reason) {
      console.error(`Could not ${nextStatus} incoming submission "${item.title}".`, reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSubmission(item: IncomingSubmission) {
    if (!window.confirm(`Permanently delete “${item.title}” from incoming submissions?`)) return;
    setBusy(true);
    setError('');
    try {
      setIncoming(
        await invoke<IncomingSubmission[]>('delete_incoming_submission', {
          id: item.id,
        }),
      );
      setNotice(`“${item.title}” was deleted from the local inbox.`);
    } catch (reason) {
      console.error(`Could not delete incoming submission "${item.title}".`, reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={`studio-connect-trigger ${status.running ? 'is-active' : ''}`}
        aria-label={`Studio Connect: Wi-Fi ${status.running ? 'active' : 'inactive'}, ${status.pendingCount} pending submissions`}
        onClick={() => setOpen(true)}
      >
        <span className="connect-trigger-icon">
          <Wifi size={14} />
        </span>
        <span>Studio Connect</span>
        <span className={`connect-status-dot ${status.running ? 'active' : ''}`} />
        {status.pendingCount > 0 && <span className="connect-pending-count">{status.pendingCount}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="studio-connect-dialog">
          <DialogHeader>
            <div className="connect-dialog-heading">
              <span className="connect-brand-mark">
                <Radio size={18} />
              </span>
              <div>
                <div className="connect-eyebrow">LOCAL · PRIVATE · OFFLINE</div>
                <DialogTitle>Studio Connect</DialogTitle>
                <DialogDescription>Receive songs, sermons, and announcements over your local Wi-Fi network. Nothing leaves this computer.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="connect-sections" role="tablist" aria-label="Studio Connect sections">
            <button type="button" role="tab" aria-selected={section === 'connect'} onClick={() => setSection('connect')}>
              <Wifi size={14} /> Wi-Fi Connect
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'incoming'}
              onClick={() => {
                setSection('incoming');
                void refreshIncoming();
              }}
            >
              <FileText size={14} /> Incoming
              {status.pendingCount > 0 && <span>{status.pendingCount}</span>}
            </button>
          </div>

          {!isTauri() && (
            <div className="connect-message desktop-note" role="note">
              <Monitor size={16} />
              <div>
                <strong>Studio Connect needs the desktop app</strong>
                <span>Only the desktop app can host the private Wi-Fi service. Open Selah Studio on your studio computer to start sharing; nearby devices can then submit from their browser, even without internet.</span>
              </div>
            </div>
          )}
          {error && (
            <div className="connect-message error" role="alert">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
          {notice && (
            <div className="connect-message success" role="status">
              <CheckCircle2 size={15} />
              {notice}
            </div>
          )}

          {section === 'connect' ? (
            <div className="connect-content">
              <div className="connect-status-card">
                <span className={`connect-pulse ${status.running ? 'active' : ''}`}>
                  <span />
                </span>
                <div className="connect-status-copy">
                  <strong>{status.running ? 'Sharing is active' : 'Wi-Fi sharing is off'}</strong>
                  <span>{status.running ? 'The local submission page is ready for your team.' : 'Start a temporary, private sharing session.'}</span>
                </div>
                <Button
                  size="sm"
                  variant={status.running ? 'outline' : 'default'}
                  disabled={busy || !isTauri()}
                  title={!isTauri() ? 'Available in the Selah Studio desktop app' : undefined}
                  onClick={() => void (status.running ? stopSharing() : startSharing())}
                >
                  {busy ? <LoaderCircle size={14} className="animate-spin" /> : status.running ? <X size={14} /> : <Wifi size={14} />}
                  {status.running ? 'Stop sharing' : 'Start sharing'}
                </Button>
              </div>

              {status.running && status.address ? (
                <div className="connect-live-grid">
                  <div className="connect-qr-card">
                    <div className="connect-qr-frame">
                      <QRCodeSVG value={status.address} size={188} level="H" includeMargin bgColor="#ffffff" fgColor="#10241c" />
                      <span className="connect-qr-center">
                        <Radio size={17} />
                      </span>
                    </div>
                    <strong>Scan to connect</strong>
                    <span>Open your camera and scan this code.</span>
                    <div className="connect-expiry">
                      <Clock3 size={12} /> Code expires {status.expiresAt ? formatTime(status.expiresAt) : 'after this session'}
                    </div>
                  </div>
                  <div className="connect-instructions">
                    <div className="connect-link-heading">
                      <div>
                        <span className="connect-eyebrow">LOCAL CONNECTION</span>
                        <strong>Connect a device</strong>
                      </div>
                      <Button size="icon" variant="ghost" aria-label="Copy connection address" title="Copy connection address" onClick={() => void copyAddress()}>
                        {copied ? <Check size={15} /> : <Clipboard size={15} />}
                      </Button>
                    </div>
                    <code className="connect-address" title={status.address}>
                      {status.address}
                    </code>
                    <div className="connect-pairing-token">
                      <span>PAIRING TOKEN</span>
                      <code>{pairingToken}</code>
                    </div>
                    <ol>
                      <li>
                        <span>1</span>Connect the sender device to this same Wi-Fi network or hotspot.
                      </li>
                      <li>
                        <span>2</span>Scan the QR code or open the local address above.
                      </li>
                      <li>
                        <span>3</span>Choose a submission type and send it for operator review.
                      </li>
                    </ol>
                    <p className="connect-scanner-hint">
                      No scanner app? Use your phone camera or offline QR scanner, or open{' '}
                      <a href="https://selahstudio.vercel.app" target="_blank" rel="noreferrer">
                        selahstudio.vercel.app
                      </a>{' '}
                      and tap “Scan Studio Connect”. The website scanner needs data to load; the submission itself stays on your local Wi-Fi.
                    </p>
                    {__SELAH_EDITION__ === 'emerald' && (
                      <p className="connect-scanner-hint">Selah Camera: install the APK from the latest GitHub Actions run, scan this QR offline or paste the local address, then choose 720p or 1080p on the phone.</p>
                    )}
                    <div className="connect-firewall-note">
                      <ShieldCheck size={14} /> If a device cannot connect, allow Selah Studio on <b>Private networks</b> in Windows Firewall.
                    </div>
                    <Button className="connect-refresh" variant="outline" size="sm" disabled={busy} onClick={() => void refreshAddress()}>
                      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
                      Refresh address &amp; QR
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="connect-offline-card">
                  <div className="connect-orbit">
                    <Wifi size={24} />
                  </div>
                  <strong>Your studio, on your local network.</strong>
                  <p>No accounts, internet, or cloud services. Start sharing to create a one-hour pairing code and QR link. Stopping sharing revokes it immediately.</p>
                </div>
              )}

              <div className="connect-metrics">
                <div>
                  <span className="connect-metric-icon">
                    <Wifi size={14} />
                  </span>
                  <strong>{status.connectedDevices}</strong>
                  <span>Devices here</span>
                </div>
                <div>
                  <span className="connect-metric-icon">
                    <LoaderCircle size={14} />
                  </span>
                  <strong>{status.activeTransfers}</strong>
                  <span>Active transfers</span>
                </div>
                <div>
                  <span className="connect-metric-icon">
                    <FileText size={14} />
                  </span>
                  <strong>{status.incomingCount}</strong>
                  <span>Received</span>
                </div>
                <div>
                  <span className="connect-metric-icon">
                    <Clock3 size={14} />
                  </span>
                  <strong>{status.pendingCount}</strong>
                  <span>Need review</span>
                </div>
                <div>
                  <span className="connect-metric-icon">
                    <AlertTriangle size={14} />
                  </span>
                  <strong>{status.failedSubmissions}</strong>
                  <span>Failed submissions</span>
                </div>
              </div>
              <p className="connect-privacy-line">
                <ShieldCheck size={13} /> Bound to a private LAN address only · no internet access required · submissions stay on this computer
              </p>
            </div>
          ) : (
            <div className="connect-incoming">
              <div className="connect-inbox-summary">
                <div>
                  <span className="connect-eyebrow">LOCAL INBOX</span>
                  <strong>
                    {incoming.length} {incoming.length === 1 ? 'submission' : 'submissions'}
                  </strong>
                  <span>Saved on this computer and available after restart.</span>
                </div>
                <div className="connect-inbox-stats">
                  <span>
                    <b>{status.pendingCount}</b> Pending
                  </span>
                  <span>
                    <b>{approvedCount}</b> Approved
                  </span>
                  <span>
                    <b>{failedCount}</b> Rejected
                  </span>
                </div>
              </div>
              <div className="connect-filter" role="tablist" aria-label="Filter submissions">
                {(['all', 'song', 'sermon', 'announcement'] as const).map((value) => (
                  <button type="button" key={value} aria-selected={filter === value} onClick={() => setFilter(value)}>
                    {value === 'all' ? 'All' : typeNames[value]}
                  </button>
                ))}
              </div>
              <div className="connect-submission-list">
                {visibleIncoming.map((item) => (
                  <article className="connect-submission" key={item.id}>
                    <div className="connect-submission-top">
                      <div className="connect-submission-type">
                        <span>{item.kind === 'song' ? <Music2 size={13} /> : <FileText size={13} />}</span>
                        {typeNames[item.kind]}
                      </div>
                      <span className={`connect-submission-status ${item.status}`}>{item.status}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <div className="connect-submission-meta">
                      {item.senderName && <span>From {item.senderName}</span>}
                      {item.author && <span>{item.author}</span>}
                      <span>{formatTime(item.submittedAt)}</span>
                    </div>
                    <details className="connect-submission-preview">
                      <summary>Preview content</summary>
                      <pre>{item.content}</pre>
                      {item.scriptureReferences && (
                        <p>
                          <b>Scripture references:</b> {item.scriptureReferences}
                        </p>
                      )}
                      {item.notes && (
                        <p>
                          <b>Notes:</b> {item.notes}
                        </p>
                      )}
                    </details>
                    <div className="connect-submission-actions">
                      {item.status === 'pending' ? (
                        <>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(item)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void setSubmissionStatus(item, 'rejected')}>
                            Reject
                          </Button>
                          <Button size="sm" disabled={busy} onClick={() => void setSubmissionStatus(item, 'approved')}>
                            <Check size={13} />
                            Approve
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setSubmissionStatus(item, 'pending')}>
                          Return to pending
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="connect-delete" aria-label={`Delete ${item.title}`} disabled={busy} onClick={() => void deleteSubmission(item)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </article>
                ))}
                {!visibleIncoming.length && (
                  <div className="connect-inbox-empty">
                    <div>
                      <FileText size={21} />
                    </div>
                    <strong>No {filter === 'all' ? 'incoming submissions' : `${typeNames[filter].toLowerCase()} submissions`} yet</strong>
                    <span>When someone submits content over Wi-Fi, it will appear here for review.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(value) => {
          if (!value) setEditing(null);
        }}
      >
        <DialogContent className="connect-edit-dialog">
          <DialogHeader>
            <DialogTitle>Edit submission</DialogTitle>
            <DialogDescription>Changes are saved only to this computer’s incoming inbox.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                void saveSubmission({
                  ...editing,
                  title: String(values.get('title') ?? '').trim(),
                  content: String(values.get('content') ?? ''),
                  author: String(values.get('author') ?? '').trim(),
                  scriptureReferences: String(values.get('scriptureReferences') ?? '').trim(),
                  notes: String(values.get('notes') ?? '').trim(),
                });
              }}
            >
              <label>
                Title
                <input name="title" defaultValue={editing.title} maxLength={120} required />
              </label>
              <label>
                Content
                <textarea name="content" defaultValue={editing.content} maxLength={20_000} required rows={8} />
              </label>
              {editing.kind !== 'announcement' && (
                <label>
                  {editing.kind === 'sermon' ? 'Speaker / preacher' : 'Author / composer'}
                  <input name="author" defaultValue={editing.author} maxLength={120} />
                </label>
              )}
              {editing.kind === 'sermon' && (
                <label>
                  Scripture references
                  <input name="scriptureReferences" defaultValue={editing.scriptureReferences} maxLength={500} />
                </label>
              )}
              <label>
                Additional notes
                <textarea name="notes" defaultValue={editing.notes} maxLength={2000} rows={3} />
              </label>
              <div className="connect-edit-actions">
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <LoaderCircle size={14} className="animate-spin" />}
                  Save changes
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
