import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";
import { useConfig } from "@/contexts/ConfigContext";

interface LogoProps {
    isCollapsed: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(({ isCollapsed }, ref) => {
  const { uiTheme } = useConfig();
  const pillBackgroundByTheme: Record<string, string> = {
    rune: 'linear-gradient(120deg, rgba(22, 28, 47, 0.98) 0%, rgba(33, 43, 68, 0.98) 100%)',
    mithril: 'linear-gradient(120deg, rgba(23, 22, 39, 0.98) 0%, rgba(41, 38, 61, 0.98) 100%)',
    bronze: 'linear-gradient(120deg, rgba(39, 25, 14, 0.98) 0%, rgba(60, 42, 22, 0.98) 100%)',
    adamant: 'linear-gradient(120deg, rgba(10, 28, 20, 0.98) 0%, rgba(18, 50, 37, 0.98) 100%)',
  };
  const pillBorderByTheme: Record<string, string> = {
    rune: 'rgba(96, 165, 250, 0.12)',
    mithril: 'rgba(125, 116, 201, 0.12)',
    bronze: 'rgba(217, 160, 90, 0.14)',
    adamant: 'rgba(45, 170, 120, 0.14)',
  };
  const pillShadowByTheme: Record<string, string> = {
    rune: '0 1px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
    mithril: '0 1px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
    bronze: '0 1px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
    adamant: '0 1px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
  };
  const pillBackground = pillBackgroundByTheme[uiTheme] ?? pillBackgroundByTheme.rune;
  const pillBorder = pillBorderByTheme[uiTheme] ?? pillBorderByTheme.rune;
  const pillShadow = pillShadowByTheme[uiTheme] ?? pillShadowByTheme.rune;

  return (
    <Dialog aria-describedby={undefined}>
      {isCollapsed ? (
        <DialogTrigger asChild>
          <button
            ref={ref}
            className="flex items-center justify-center mb-2 cursor-pointer bg-transparent border-none p-0 hover:opacity-80 transition-opacity"
            aria-label="Open Adamant info"
          >
            <img src="/logo-collapsed.png" alt="Adamant" className="w-8 h-8 object-contain" />
          </button>
        </DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <span
            className="flex items-center justify-center gap-2 text-lg text-center border rounded-full font-semibold mb-2 block cursor-pointer px-4 py-2 backdrop-blur-md relative overflow-hidden"
            style={{
              borderColor: pillBorder,
              color: 'rgba(255,255,255,0.92)',
              backgroundImage: pillBackground,
              backgroundRepeat: 'no-repeat',
              boxShadow: pillShadow,
            }}
          >
            <img src="/logo.png" alt="Adamant" className="w-8 h-8 object-contain" />
            <span>Adamant</span>
          </span>
        </DialogTrigger>
      )}
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About Adamant</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Logo.displayName = "Logo";

export default Logo;
