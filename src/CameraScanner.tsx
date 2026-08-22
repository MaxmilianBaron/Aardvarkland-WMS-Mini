import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';

interface CameraScannerProps {
  hint: string;
  denied: string;
  onResult: (value: string) => void;
  onClose: () => void;
}

export function CameraScanner({ hint, denied, onResult, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const resultHandled = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const reader = new BrowserMultiFormatReader();

    reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, videoRef.current ?? undefined, (result, _error, controls) => {
      controlsRef.current = controls;
      if (!active || !result || resultHandled.current) return;
      resultHandled.current = true;
      controls.stop();
      onResult(result.getText());
    }).catch(() => {
      if (!active) return;
      setError(true);
    });

    return () => {
      active = false;
      controlsRef.current?.stop();
    };
  }, [denied, onResult]);

  return (
    <div className="camera-backdrop" role="dialog" aria-modal="true" aria-label={hint}>
      <div className="camera-panel">
        <video ref={videoRef} muted playsInline autoPlay />
        {error && <p className="camera-error" role="alert">{denied}</p>}
        <p>{hint}</p>
        <button type="button" className="button button--secondary" onClick={onClose}>×</button>
      </div>
    </div>
  );
}
