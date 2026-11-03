import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Camera, RefreshCw, Video } from 'lucide-react';

type Props = {
  active: boolean;
  resolution: 720 | 1080;
  frame: string | undefined;
};

type VideoInput = {
  deviceId: string;
  label: string;
};

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not encode the capture-card frame.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the encoded capture-card frame.'));
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

export function EmeraldCameraInput({ active, resolution, frame }: Props) {
  const [devices, setDevices] = useState<VideoInput[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [stream, setStream] = useState<MediaStream>();
  const [status, setStatus] = useState('Connect a USB HDMI capture card to preview a camera.');
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const publishing = useRef(false);
  const publishErrorShown = useRef(false);

  const findDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      setStatus('Camera input is unavailable in this Windows WebView.');
      return;
    }

    setLoading(true);
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      const inputs = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Video input ${index + 1}`,
        }));
      setDevices(inputs);
      setDeviceId((current) => (inputs.some((device) => device.deviceId === current) ? current : (inputs[0]?.deviceId ?? '')));
      setStatus(inputs.length ? `${inputs.length} video input${inputs.length === 1 ? '' : 's'} found. Choose the capture card.` : 'No video input found. Check the USB capture card connection.');
    } catch (error) {
      console.error('Could not enumerate HDMI capture devices.', error);
      setStatus(error instanceof Error ? error.message : 'Camera permission was denied.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !deviceId) {
      setStream(undefined);
      void invoke('clear_hdmi_camera_frame').catch((error) => {
        console.error('Could not clear the HDMI camera preview frame.', error);
      });
      return;
    }

    let cancelled = false;
    let activeStream: MediaStream | undefined;
    setStatus('Opening capture-card preview…');
    void navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: resolution === 1080 ? 1920 : 1280 },
          height: { ideal: resolution === 1080 ? 1080 : 720 },
          frameRate: { ideal: 15, max: 20 },
        },
        audio: false,
      })
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        activeStream = nextStream;
        setStream(nextStream);
        setStatus('Capture-card preview is ready.');
      })
      .catch((error: unknown) => {
        console.error('Could not open the HDMI capture device.', error);
        setStatus(error instanceof Error ? error.message : 'Could not open this video input.');
      });

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
      setStream(undefined);
      void invoke('clear_hdmi_camera_frame').catch((error) => {
        console.error('Could not clear the HDMI camera frame.', error);
      });
    };
  }, [active, deviceId, resolution]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch((error) => {
      console.error('Could not play the HDMI camera preview.', error);
      setStatus('Could not play the capture-card preview.');
    });
  }, [stream]);

  useEffect(() => {
    if (!active || !stream) return;
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled || publishing.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      publishing.current = true;
      void (async () => {
        const maxWidth = resolution === 1080 ? 1920 : 1280;
        const initialScale = Math.min(1, maxWidth / video.videoWidth);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare a capture-card frame.');

        for (const scale of [initialScale, initialScale * 0.8, initialScale * 0.64, initialScale * 0.5]) {
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          for (const quality of [0.58, 0.48, 0.38, 0.28]) {
            const frameData = await canvasToJpeg(canvas, quality);
            if (frameData.length <= 680_000) return frameData;
          }
        }
        throw new Error('This capture device is producing frames that exceed the local feed limit.');
      })()
        .then(async (frameData) => {
          if (cancelled) return;
          await invoke('set_hdmi_camera_frame', { frame: frameData });
          publishErrorShown.current = false;
        })
        .catch((error: unknown) => {
          console.error('Could not publish an HDMI camera frame.', error);
          if (!publishErrorShown.current) {
            setStatus(error instanceof Error ? error.message : 'Could not publish the capture-card frame.');
            publishErrorShown.current = true;
          }
        })
        .finally(() => {
          publishing.current = false;
        });
    }, 100);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, stream]);

  return (
    <div className="emerald-hdmi-input">
      <div className="emerald-hdmi-preview">
        {active && stream ? <video ref={videoRef} autoPlay playsInline muted aria-label="Muted HDMI camera preview" /> : frame ? <img src={frame} alt="HDMI camera frame" /> : <Video size={20} aria-hidden="true" />}
      </div>
      <div className="emerald-hdmi-controls">
        <strong>USB HDMI capture</strong>
        <span>{status}</span>
        <div className="emerald-hdmi-actions">
          <select aria-label="HDMI capture device" value={deviceId} disabled={!devices.length} onChange={(event) => setDeviceId(event.target.value)}>
            {!devices.length && <option value="">No capture card selected</option>}
            {devices.map((device) => (
              <option value={device.deviceId} key={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void findDevices()} disabled={loading}>
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Camera size={13} />}
            {loading ? 'Searching' : 'Find inputs'}
          </button>
        </div>
      </div>
    </div>
  );
}
