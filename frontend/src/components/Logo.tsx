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
          <span className="flex items-center justify-center gap-2 text-lg text-center border rounded-full bg-white/10 border-white/15 font-semibold text-foreground/90 mb-2 block cursor-pointer hover:bg-white/15 transition-colors px-4 py-2 backdrop-blur-md">
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
