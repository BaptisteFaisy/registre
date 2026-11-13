import { useId } from 'react';

/** Registre mark: a glossy black tile with a chrome rim, three lit ledger lines and a blue seal. */
export function BrandMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const ref = (name: string) => `url(#${id}${name})`;
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stopColor="#30363e" />
          <stop offset=".42" stopColor="#0e1013" />
          <stop offset="1" stopColor="#040506" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".18" stopColor="#7d8794" />
          <stop offset=".5" stopColor="#16191d" />
          <stop offset=".78" stopColor="#3d4652" />
          <stop offset="1" stopColor="#7aa4ff" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8CF7D6" />
          <stop offset="1" stopColor="#9ADBF5" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="17" fill={ref('b')} />
      <rect x="3.8" y="3.8" width="56.4" height="56.4" rx="16.2" fill="none" stroke={ref('r')} strokeWidth="1.6" />
      <g fill="#030405" stroke="#4a525d" strokeWidth="1">
        <rect x="15" y="16" width="34" height="8" rx="4" />
        <rect x="15" y="28" width="34" height="8" rx="4" />
        <rect x="15" y="40" width="22" height="8" rx="4" />
        <circle cx="45" cy="44" r="5.2" />
      </g>
      <rect x="18" y="18.6" width="28" height="2.8" rx="1.4" fill={ref('l')} />
      <rect x="18" y="30.6" width="28" height="2.8" rx="1.4" fill={ref('l')} />
      <rect x="18" y="42.6" width="16" height="2.8" rx="1.4" fill={ref('l')} />
      <circle cx="45" cy="44" r="3.4" fill="#7FA6FF" />
    </svg>
  );
}
