import type { CSSProperties, ReactNode } from "react";

interface IconProps { readonly size?: number; readonly style?: CSSProperties; readonly className?: string; }

function Svg({ size = 14, style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
function BrandSvg({ size = 14, style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

// — minimal stroke UI —

export function FolderIcon(p: IconProps) { return <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>; }
export function FolderPlusIcon(p: IconProps) { return <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v6M9 14h6" /></Svg>; }
export function RefreshIcon(p: IconProps) { return <Svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></Svg>; }
export function PlusIcon(p: IconProps) { return <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>; }
export function XIcon(p: IconProps) { return <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>; }
export function ArrowRightIcon(p: IconProps) { return <Svg {...p}><path d="M5 12h14M13 5l7 7-7 7" /></Svg>; }
export function TerminalIcon(p: IconProps) { return <Svg {...p}><path d="M4 17l6-5-6-5M12 19h8" /></Svg>; }
export function CopyIcon(p: IconProps) { return <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></Svg>; }

export function CheckIcon(p: IconProps) { return <Svg {...p}><path d="M5 13l4 4L19 7" /></Svg>; }
export function SparklesIcon(p: IconProps) { return <Svg {...p}><path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2z" /><path d="M19 11l.9 2.1L22 14l-2.1.9L19 17l-.9-2.1L16 14l2.1-.9z" /><path d="M5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9z" /></Svg>; }
export function LayersIcon(p: IconProps) { return <Svg {...p}><path d="M12 2L2 7l10 5 10-5z" /><path d="M2 12l10 5 10-5" /><path d="M2 17l10 5 10-5" /></Svg>; }
export function GridIcon(p: IconProps) { return <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></Svg>; }
export function LayoutGridIcon(p: IconProps) { return <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M3 15h18" /></Svg>; }
export function HistoryIcon(p: IconProps) { return <Svg {...p}><path d="M12 7v5l3 3" /><circle cx="12" cy="12" r="9" /><path d="M3 12a9 9 0 0 1 9-9" /></Svg>; }
export function ClockIcon(p: IconProps) { return <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>; }
export function BookmarkIcon(p: IconProps) { return <Svg {...p}><path d="M6 3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z" /></Svg>; }
export function SaveIcon(p: IconProps) { return <Svg {...p}><path d="M6 3h10l3 3v15H6z" /><path d="M9 3v6h6" /><path d="M9 16h6" /></Svg>; }
export function TrashIcon(p: IconProps) { return <Svg {...p}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M7 6l1 14h8l1-14" /><path d="M10 11v6M14 11v6" /></Svg>; }
export function PencilIcon(p: IconProps) { return <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>; }
export function InboxIcon(p: IconProps) { return <Svg {...p}><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M3 7l3-3h12l3 3" /><path d="M12 12v6" /><path d="M9 15l3 3 3-3" /></Svg>; }
export function InfoIcon(p: IconProps) { return <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></Svg>; }
export function CompassIcon(p: IconProps) { return <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M16.1 7.9l-2.7 6.5-6.5 2.7 2.7-6.5z" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></Svg>; }
export function CodeIcon(p: IconProps) { return <Svg {...p}><path d="M9 7l-5 5 5 5" /><path d="M15 7l5 5-5 5" /><path d="M13 3l-2 18" /></Svg>; }
export function BarChart3Icon(p: IconProps) { return <Svg {...p}><path d="M6 20V12M12 20V4M18 20V8" /><path d="M3 20h18" /></Svg>; }
export function ShareIcon(p: IconProps) { return <Svg {...p}><path d="M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" /><path d="M12 16V3" /><path d="M8 7l4-4 4 4" /></Svg>; }
export function MapwLogo({ size = 22, style, className }: IconProps) {
  // Stacked terminal panes — line art from the official lockup (Terminals, like paper.)
  // Stroke #2E2E2E on white, 3 panes with the front carrying >_ . Matches website/logo.svg
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={style} className={className} aria-hidden="true" focusable="false">
      {/* back */}
      <path d="M5 8.5 L10 3.5 L26 3.5 L26 18.5 L7.5 18.5 L5 15.2 Z" fill="white" stroke="#2E2E2E" strokeWidth={1.55} strokeLinejoin="round" strokeLinecap="round" />
      {/* middle-right */}
      <path d="M15 7 L20 3.5 L28.5 3.5 L28.5 19 L17 19 L15 16 Z" fill="white" stroke="#2E2E2E" strokeWidth={1.15} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
      {/* front — the hero */}
      <path d="M7 13.5 L12 8.2 L27.5 8.2 L27.5 24.2 L9.5 24.2 L7 21 Z" fill="white" stroke="#2E2E2E" strokeWidth={1.65} strokeLinejoin="round" strokeLinecap="round" />
      {/* bottom peek */}
      <path d="M8 24.2 L9.5 27.8 L22 28.5 L25 25.5" fill="none" stroke="#2E2E2E" strokeWidth={1.15} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
      {/* >_ */}
      <path d="M13.2 14.2 L17 17 L13.2 19.8" fill="none" stroke="#2E2E2E" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.8 20.2 H22.4" stroke="#2E2E2E" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  );
}

// — official brand marks (filled, monochrome adaptable) —

export function OpenAIIcon(p: IconProps) {
  // Official OpenAI mark geometry (Simple Icons, MIT). Fill uses currentColor for theme adaptability.
  return (
    <BrandSvg {...p} >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </BrandSvg>
  );
}
export function ClaudeIcon(p: IconProps) {
  return (
    <BrandSvg {...p}>
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </BrandSvg>
  );
}
export function GeminiIcon(p: IconProps) {
  // 4-point sparkle — Gemini's signature glyph (Google Gemini). Geometric, not Simple Icons derived.
  return (
    <BrandSvg {...p}>
      <path d="M12 2l2.1 5.9L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-2.1z" />
      <path d="M19 13l1.2 2.8L23 17l-2.8 1.2L19 21l-1.2-2.8L15 17l2.8-1.2z" opacity={0.95} />
      <path d="M5 13l1.1 2.1L8.2 16.2 6.1 17.3 5 19.5l-1.1-2.2L1.8 16.2l2.1-1.1z" opacity={0.9} />
    </BrandSvg>
  );
}
export function OpenCodeIcon(p: IconProps) {
  return (
    <BrandSvg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M9 9l-2.8 3L9 15" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 9l2.8 3-2.8 3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.2 7l-2.4 10" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </BrandSvg>
  );
}
export function AiderIcon(p: IconProps) {
  return (
    <BrandSvg {...p}>
      <path d="M12 4l7.2 14H16l-1.1-2.4H9.1L8 18H4.8zM10.1 13.4h3.8L12 9z" />
    </BrandSvg>
  );
}
export function AmpIcon(p: IconProps) {
  return (
    <BrandSvg {...p}>
      <path d="M13 2L4 13h5.2L10 22l9-12h-5.2z" />
    </BrandSvg>
  );
}

// map for CLI ids — colored: each CLI gets its own hue
import type { ComponentType } from "react";
export const cliBrandIcon: Record<string, ComponentType<IconProps>> = {
  opencode: OpenCodeIcon,
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  gemini: GeminiIcon,
  aider: AiderIcon,
  amp: AmpIcon,
};
const cliColor: Record<string, string> = {
  opencode: "#134E4A",
  claude: "#D97706",
  codex: "#111827",
  gemini: "#2563EB",
  aider: "#6B7280",
  amp: "#F59E0B",
};
export function CliIcon({ id, size = 12, style, className }: IconProps & { id: string }) {
  const C = cliBrandIcon[id] ?? CodeIcon;
  const c = cliColor[id];
  return <C size={size} style={c ? { color: c, ...style } : style} className={className} />;
}
