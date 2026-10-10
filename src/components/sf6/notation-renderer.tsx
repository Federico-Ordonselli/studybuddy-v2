import { parseNotation, type Token } from "@/lib/sf6/notation";
import { cn } from "@/lib/cn";

/**
 * Visual renderer for an FGC notation string.
 * Reads as a horizontal flow of chips with separators.
 *
 * Size variants:
 *   - sm: inline/compact
 *   - md: normal
 *   - lg: hero (combo card header)
 */
export function NotationRenderer({
  text,
  size = "md",
  className,
}: {
  text: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tokens = parseNotation(text);

  if (tokens.length === 0) {
    return (
      <span className={cn("text-[var(--color-fg-dim)] italic text-sm", className)}>
        (vuota)
      </span>
    );
  }

  const gapClass = size === "sm" ? "gap-1" : size === "lg" ? "gap-2" : "gap-1.5";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center font-[var(--font-mono)]",
        gapClass,
        className
      )}
    >
      {tokens.map((tok, i) => (
        <TokenChip key={i} token={tok} size={size} />
      ))}
    </div>
  );
}

function TokenChip({ token, size }: { token: Token; size: "sm" | "md" | "lg" }) {
  const baseSize = size === "sm" ? "text-[10px] px-1.5 py-0.5" : size === "lg" ? "text-sm px-2.5 py-1" : "text-[11.5px] px-2 py-0.5";

  switch (token.kind) {
    case "separator": {
      const symbol = token.sep === "cancel" ? "›" : token.sep === "link" ? "+" : "~";
      return (
        <span
          className={cn(
            "select-none text-[var(--color-fg-dim)] leading-none",
            size === "sm" ? "text-xs px-0.5" : size === "lg" ? "text-xl px-1" : "text-base px-0.5"
          )}
        >
          {symbol}
        </span>
      );
    }

    case "modifier":
      return (
        <span
          className={cn(
            "rounded-md text-[var(--color-fg-dim)] uppercase tracking-wide leading-none",
            baseSize
          )}
        >
          {token.label}
        </span>
      );

    case "motion": {
      // Motion: box with the unicode arrow path
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg)] leading-none",
            baseSize
          )}
          title={token.label === token.numpad ? token.numpad : `${token.label} (${token.numpad})`}
        >
          <span className={size === "lg" ? "text-base" : "text-sm"}>{token.arrow}</span>
        </span>
      );
    }

    case "button": {
      const isPunch = token.family === "P" || token.family === "PP";
      const intensity =
        token.strength === "H" ? "heavy" :
        token.strength === "M" ? "medium" :
        token.strength === "L" ? "light" : "any";
      const palette = isPunch ? PUNCH_STYLES : KICK_STYLES;
      const style = palette[intensity];
      return (
        <span
          className={cn(
            "rounded-md font-bold tracking-wide leading-none transition-colors",
            baseSize,
            style
          )}
        >
          {token.label}
        </span>
      );
    }

    case "drive":
      return (
        <span
          className={cn(
            "rounded-md font-semibold leading-none border border-[var(--color-accent-soft)] bg-[var(--color-accent)]/15 text-[var(--color-accent)] uppercase tracking-wider",
            baseSize
          )}
          title={token.label}
        >
          {token.raw.toUpperCase()}
        </span>
      );

    case "super":
      return (
        <span
          className={cn(
            "rounded-md font-bold leading-none border border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)] uppercase tracking-wider",
            baseSize
          )}
          title={token.label}
        >
          {token.raw.toUpperCase()}
        </span>
      );

    case "text":
    default:
      return (
        <span className={cn("text-[var(--color-fg-muted)] leading-none", baseSize)}>
          {token.raw}
        </span>
      );
  }
}

// Color palettes for buttons. Punch = warm (amber-ish), Kick = cool (blue-teal).
// Light = outline, Medium = subtle fill, Heavy = full fill.
const PUNCH_STYLES: Record<string, string> = {
  light:  "border border-[var(--accent)]/60 text-[var(--accent)]",
  medium: "border border-[var(--accent)]/70 bg-[var(--accent)]/15 text-[var(--accent)]",
  heavy:  "border border-[var(--accent)] bg-[var(--accent)]/30 text-[var(--accent)]",
  any:    "border border-dashed border-[var(--accent)]/60 text-[var(--accent)]",
};

const KICK_STYLES: Record<string, string> = {
  light:  "border border-[var(--color-ok)]/60 text-[var(--color-ok)]",
  medium: "border border-[var(--color-ok)]/70 bg-[var(--color-ok)]/15 text-[var(--color-ok)]",
  heavy:  "border border-[var(--color-ok)] bg-[var(--color-ok)]/30 text-[var(--color-ok)]",
  any:    "border border-dashed border-[var(--color-ok)]/60 text-[var(--color-ok)]",
};
