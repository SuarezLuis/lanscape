// Plug icon from lucide (ISC), animated like the lucide-animated set: the plug pushes in on hover
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useImperativeHandle } from "react";

interface PlugIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PlugIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const PlugIcon = forwardRef<PlugIconHandle, PlugIconProps>(({ size = 28, ...props }, ref) => {
  const controls = useAnimation();
  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start({ y: [0, 2, 0], transition: { duration: 0.5, ease: "easeInOut" } }),
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
        <path d="M12 22v-5" />
        <motion.g animate={controls}>
          <path d="M9 8V2" />
          <path d="M15 8V2" />
          <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
        </motion.g>
      </svg>
    </div>
  );
});

PlugIcon.displayName = "PlugIcon";

export { PlugIcon };
