type IconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
};

const base = (size: number, strokeWidth: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function IconTimer({ size = 13, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9.5V13l2.4 1.6" />
      <path d="M9.5 2.5h5" />
    </svg>
  );
}

export function IconList({ size = 13, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M3.5 6.5l1.8 1.8 3-3.2" />
      <path d="M3.5 12.7l1.8 1.8 3-3.2" />
      <path d="M3.5 18.9l1.8 1.8 3-3.2" />
      <path d="M12.5 7h8" />
      <path d="M12.5 13.2h8" />
      <path d="M12.5 19.4h8" />
    </svg>
  );
}

export function IconClose({ size = 12, strokeWidth = 2, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function IconPlay({ size = 14, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...rest}
    >
      <path d="M8 5.2c0-.8.9-1.3 1.6-.9l8.6 5.9a1.1 1.1 0 010 1.8l-8.6 6c-.7.4-1.6-.1-1.6-.9V5.2z" />
    </svg>
  );
}

export function IconPause({ size = 14, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...rest}
    >
      <rect x="7" y="4.5" width="3.6" height="15" rx="1.4" />
      <rect x="13.4" y="4.5" width="3.6" height="15" rx="1.4" />
    </svg>
  );
}

export function IconReset({ size = 14, strokeWidth = 1.9, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M4 10.5a8 8 0 1 1 1.4 7" />
      <path d="M3.6 4.8v5.6h5.6" />
    </svg>
  );
}

export function IconStar({
  size = 13,
  filled = false,
  ...rest
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M12 3.6l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.8 1-5.85L3.5 9.75l5.9-.85L12 3.6z" />
    </svg>
  );
}

export function IconTrash({ size = 13, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6.6 6.5l.8 12.2c0 .8.7 1.5 1.5 1.5h6.2c.8 0 1.5-.7 1.5-1.5l.8-12.2" />
    </svg>
  );
}

export function IconCheck({ size = 11, strokeWidth = 2.6, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function IconPlus({ size = 14, strokeWidth = 1.9, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconBell({ size = 13, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M18 8.5a6 6 0 10-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5z" />
      <path d="M10.3 19a2 2 0 003.4 0" />
    </svg>
  );
}

export function IconGear({ size = 13, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 14.4a1.6 1.6 0 00.32 1.77l.06.06a1.9 1.9 0 11-2.7 2.7l-.05-.06a1.6 1.6 0 00-1.78-.32 1.6 1.6 0 00-.97 1.47v.17a1.9 1.9 0 11-3.8 0v-.09a1.6 1.6 0 00-1.05-1.47 1.6 1.6 0 00-1.77.32l-.06.06a1.9 1.9 0 11-2.7-2.7l.06-.06a1.6 1.6 0 00.32-1.77 1.6 1.6 0 00-1.47-.97h-.17a1.9 1.9 0 110-3.8h.09a1.6 1.6 0 001.47-1.05 1.6 1.6 0 00-.32-1.77l-.06-.06a1.9 1.9 0 112.7-2.7l.06.06a1.6 1.6 0 001.77.32h.08a1.6 1.6 0 00.97-1.47v-.17a1.9 1.9 0 113.8 0v.09a1.6 1.6 0 00.97 1.47 1.6 1.6 0 001.77-.32l.06-.06a1.9 1.9 0 112.7 2.7l-.06.06a1.6 1.6 0 00-.32 1.77v.08a1.6 1.6 0 001.47.97h.17a1.9 1.9 0 110 3.8h-.09a1.6 1.6 0 00-1.47.97z" />
    </svg>
  );
}

export function IconArrowLeft({ size = 13, strokeWidth = 2, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  );
}

export function IconChevronDown({ size = 12, strokeWidth = 2, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

export function IconPencil({ size = 12, strokeWidth = 1.8, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 7.5l3 3" />
    </svg>
  );
}

export function IconLayers({ size = 13, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)} {...rest}>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.5L12 21l8.5-4.5" />
    </svg>
  );
}
