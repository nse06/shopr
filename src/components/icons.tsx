// A few line icons, drawn to match the type: light strokes with round ends.

type Props = { size?: number; title?: string };

function Svg({ size = 20, title, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const ArrowUp = (p: Props) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const ArrowRight = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ArrowOut = (p: Props) => (
  <Svg {...p}>
    <path d="M8 16L16 8M9 8h7v7" />
  </Svg>
);

export const ImagePlus = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4H4v16h16V10" />
    <path d="M4 16l5-5 4 4 2-2 5 5" />
    <path d="M19 2v6M16 5h6" />
  </Svg>
);

export const Close = (p: Props) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const Heart = ({ filled, ...p }: Props & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"
      fill={filled ? "currentColor" : "none"}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const Sliders = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <path d="M14 4.5v5M8 14.5v5" />
  </Svg>
);

export const Camera = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h3l2-2h6l2 2h3v12H4z" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const Refresh = (p: Props) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const Check = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinejoin="round" />
  </Svg>
);

export const Plus = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Search = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
);

export const ChevronLeft = (p: Props) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" strokeLinejoin="round" />
  </Svg>
);

export const ChevronRight = (p: Props) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" strokeLinejoin="round" />
  </Svg>
);

/** The four-point sparkle next to "Picked for you". */
export function Sparkle({ size = 22, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 1.5c.9 5.4 3.1 7.6 8.5 8.5-5.4.9-7.6 3.1-8.5 8.5-.9-5.4-3.1-7.6-8.5-8.5 5.4-.9 7.6-3.1 8.5-8.5z" />
    </svg>
  );
}
