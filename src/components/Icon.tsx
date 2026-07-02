import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "sale"
  | "purchase"
  | "scan"
  | "customers"
  | "devices"
  | "documents"
  | "ledger"
  | "accounts"
  | "settings"
  | "plus"
  | "search"
  | "check"
  | "warning"
  | "close"
  | "print"
  | "upload"
  | "menu"
  | "arrowRight"
  | "download";

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9 20v-6h6v6"/></>,
  sale: <><path d="M4 7h16l-1.5 8h-13z"/><path d="M7 7l2-3h6l2 3"/><circle cx="8" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></>,
  purchase: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></>,
  scan: <><path d="M4 8V4h4"/><path d="M16 4h4v4"/><path d="M20 16v4h-4"/><path d="M8 20H4v-4"/><path d="M7 12h10"/></>,
  customers: <><circle cx="9" cy="8" r="3"/><path d="M3 20c.6-4 2.6-6 6-6s5.4 2 6 6"/><circle cx="17" cy="9" r="2"/><path d="M15 14c3 0 5 1.8 6 5"/></>,
  devices: <><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 5h4"/><path d="M11 18.5h2"/></>,
  documents: <><path d="M6 2.5h8l4 4V21H6z"/><path d="M14 2.5v5h5"/><path d="M9 12h6M9 16h6"/></>,
  ledger: <><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h3M14 15h2"/></>,
  accounts: <><path d="M3 8h18"/><path d="M5 8v10M9 8v10M15 8v10M19 8v10"/><path d="M2 20h20M12 3 3 7h18z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="m12 3 10 18H2z"/><path d="M12 9v5M12 18h.01"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  print: <><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></>,
  upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  arrowRight: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  download: <><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
