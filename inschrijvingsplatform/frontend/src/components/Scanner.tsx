import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

/**
 * QR-codes scannen met de camera, in de pagina zelf (zonder de camera-app, die elke scan in een nieuw tabblad opent).
 * jsQR leest de beelden; werkt in Safari (iPhone) en Chrome (Android). De camera vraagt https (of localhost).
 * Dezelfde code twee keer na elkaar telt maar één keer (binnen 3 seconden).
 */
export function Scanner({ onCode, onSluit, uitleg }: { onCode: (tekst: string) => void; onSluit: () => void; uitleg?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [fout, setFout] = useState('');
  const laatste = useRef({ tekst: '', tijd: 0 });
  const terug = useRef(onCode);
  terug.current = onCode;

  useEffect(() => {
    let stroom: MediaStream | null = null;
    let timer = 0;
    let gestopt = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const lees = () => {
      const v = video.current;
      if (gestopt || !v || !ctx) return;
      if (v.readyState >= 2 && v.videoWidth) {
        // Verkleinen: sneller, en QR-codes blijven ruim leesbaar.
        const schaal = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * schaal);
        canvas.height = Math.round(v.videoHeight * schaal);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const beeld = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(beeld.data, beeld.width, beeld.height, { inversionAttempts: 'attemptBoth' });
        if (code?.data) {
          const nu = Date.now();
          if (code.data !== laatste.current.tekst || nu - laatste.current.tijd > 3000) {
            laatste.current = { tekst: code.data, tijd: nu };
            navigator.vibrate?.(80);
            terug.current(code.data);
          }
        }
      }
      timer = window.setTimeout(lees, 200);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (gestopt) return s.getTracks().forEach((t) => t.stop());
        stroom = s;
        const v = video.current!;
        v.srcObject = s;
        v.setAttribute('playsinline', 'true'); // iPhone: niet schermvullend openen
        return v.play().then(lees);
      })
      .catch(() => setFout('De camera kon niet starten. Geef de browser toestemming om de camera te gebruiken.'));
    if (!navigator.mediaDevices) setFout('Deze browser kan de camera niet gebruiken. Gebruik de camera-app van je telefoon.');

    return () => {
      gestopt = true;
      clearTimeout(timer);
      stroom?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-label="QR-code scannen">
      <video ref={video} className="scanner__beeld" muted playsInline aria-hidden="true" />
      <div className="scanner__kader" aria-hidden="true" />
      <div className="scanner__balk">
        <p>{fout || uitleg || 'Richt de camera op de QR-code.'}</p>
        <button type="button" className="dag-knop dag-knop--licht" onClick={onSluit}>Sluiten</button>
      </div>
    </div>
  );
}
