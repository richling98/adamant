import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface LogoProps {
    isCollapsed: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(({ isCollapsed }, ref) => {
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
              borderColor: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.92)',
              background: 'linear-gradient(120deg, #1a1a1f 0%, #2a2a32 20%, #3a3a44 35%, #4a4a55 50%, #3a3a44 65%, #2a2a32 80%, #1a1a1f 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 4s ease-in-out infinite',
              boxShadow: '0 1px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <style>{`
              @keyframes shimmer {
                0%   { background-position: 200% center; }
                50%  { background-position: 0% center; }
                100% { background-position: 200% center; }
              }
            `}</style>
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
