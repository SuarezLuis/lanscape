// Stethoscope icon from lucide (ISC), animated like the lucide-animated set: the chest piece swings on hover
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useImperativeHandle } from "react";

interface StethoscopeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface StethoscopeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const StethoscopeIcon = forwardRef<StethoscopeIconHandle, StethoscopeIconProps>(({ size = 28, ...props }, ref) => {
  const controls = useAnimation();
  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start({ rotate: [0, 12, -6, 0], transition: { duration: 0.6, ease: "easeInOut" } }),
    stopAnimation: () => controls.start({ rotate: 0 }),
  }));

  return (
    <div {...props}>
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M11 2v2" />
        <path d="M5 2v2" />
        <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
        <motion.g animate={controls} style={{ originX: "8px", originY: "15px" }}>
          <path d="M8 15a6 6 0 0 0 12 0v-3" />
          <circle cx="20" cy="10" r="2" />
        </motion.g>
      </svg>
    </div>
  );
});

StethoscopeIcon.displayName = "StethoscopeIcon";

export { StethoscopeIcon };
