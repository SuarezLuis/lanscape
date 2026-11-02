// Layout-dashboard icon from lucide (ISC), animated like the lucide-animated set: the tiles nudge on hover
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useImperativeHandle } from "react";

interface DashboardIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface DashboardIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DashboardIcon = forwardRef<DashboardIconHandle, DashboardIconProps>(({ size = 28, ...props }, ref) => {
  const controls = useAnimation();
  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start({ y: [0, -1.5, 0], transition: { duration: 0.4, ease: "easeInOut" } }),
    stopAnimation: () => controls.start({ y: 0 }),
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
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <motion.g animate={controls}>
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
        </motion.g>
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    </div>
  );
});

DashboardIcon.displayName = "DashboardIcon";

export { DashboardIcon };
