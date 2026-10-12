// A few line icons, drawn to match the type: thin strokes, square ends.

type Props = { size?: number; title?: string };

function Svg({ size = 20, title, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
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
