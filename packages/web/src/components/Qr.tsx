import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrProps {
  value: string;
  size?: number;
}

/** QR code généré localement : aucun service externe n'est sollicité. */
export function Qr({ value, size = 320 }: QrProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Généré à la densité de pixels de l'écran : net même affiché en grand (TV 4K, DPR élevé).
    const density = Math.min(3, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    QRCode.toDataURL(value, {
      width: Math.round(size * density),
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0d0a1f', light: '#ffffff' },
    })
      .then((url) => active && setSrc(url))
      .catch(() => active && setSrc(null));
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!src) return <div className="qr-placeholder" aria-hidden="true" />;
  return <img className="qr" src={src} width={size} height={size} alt={`QR code : ${value}`} />;
}
