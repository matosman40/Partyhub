import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'tv'
  | 'phone'
  | 'players'
  | 'join'
  | 'store'
  | 'search'
  | 'settings'
  | 'profile'
  | 'menu'
  | 'close'
  | 'back'
  | 'play'
  | 'sound'
  | 'muted'
  | 'trophy'
  | 'star'
  | 'info'
  | 'plus'
  | 'chevron'
  | 'filter'
  | 'sun'
  | 'moon'
  | 'camera'
  | 'package'
  | 'puzzle'
  | 'link'
  | 'edit'
  | 'video'
  | 'copy'
  | 'pause'
  | 'flag';

const paths: Record<IconName, ReactNode> = {
  tv: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="1" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  phone: <rect x="7" y="2.5" width="10" height="19" rx="2" />,
  players: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-1a6 6 0 0 1 12 0v1zM17 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V20" />
    </>
  ),
  join: <path d="M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M3 12h12m-5-5 5 5-5 5" />,
  store: (
    <>
      <path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="m9.7 3 .6-1h3.4l.6 1 1.7 1 1.2-.2 1.7 2.9-.6 1.1.1 2 1 .8v3.3l-1 .8-.1 2 .6 1.1-1.7 2.9-1.2-.2-1.7 1-.6 1h-3.4l-.6-1-1.7-1-1.2.2-1.7-2.9.6-1.1-.1-2-1-.8v-3.3l1-.8.1-2-.6-1.1 1.7-2.9 1.2.2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1z" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  back: <path d="M19 12H5m0 0 7-7m-7 7 7 7" />,
  play: <path d="m7 4 13 8-13 8z" />,
  sound: <path d="M4 9v6h4l5 4V5L8 9zm13 0a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12" />,
  muted: <path d="M4 9v6h4l5 4V5L8 9zm13 0 5 6m0-6-5 6" />,
  trophy: (
    <>
      <path d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m12.8-12.8-1.4 1.4" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.7 8.7 0 1 0 20.5 14.5z" />,
  camera: (
    <>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="14" r="3.5" />
    </>
  ),
  package: <path d="m12 3 9 5v9l-9 5-9-5V8zm-9 5 9 5 9-5m-9 5v9m-4-17 9 5" />,
  puzzle: <path d="M4 4h6a2 2 0 1 1 4 0h6v6a2 2 0 1 0 0 4v6h-6a2 2 0 1 0-4 0H4v-6a2 2 0 1 1 0-4z" />,
  link: (
    <path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7m2.7 6.4a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7" />
  ),
  edit: <path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4zM14.5 6l3.5 3.5" />,
  video: (
    <>
      <rect x="3" y="5" width="13" height="14" rx="1" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  pause: <path d="M8 5v14m8-14v14" />,
  flag: <path d="M5 21V4m0 1h13l-2 4 2 4H5" />,
};

export function Icon({
  name,
  size = 24,
  className,
  ...props
}: { name: IconName; size?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name' | 'width' | 'height'>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
