// Coffee icon from lucide (ISC), animated like the lucide-animated set: the steam rises on hover
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useImperativeHandle } from "react";

interface CoffeeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CoffeeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CoffeeIcon = forwardRef<CoffeeIconHandle, CoffeeIconProps>(({ size = 28, ...props }, ref) => {
  const controls = useAnimation();
  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start({ y: [0, -2, 0], opacity: [1, 0.4, 1], transition: { duration: 0.8, ease: "easeInOut" } }),
    stopAnimation: () => controls.start({ y: 0, opacity: 1 }),
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
        <motion.g animate={controls}>
          <path d="M10 2v2" />
          <path d="M14 2v2" />
          <path d="M6 2v2" />
        </motion.g>
        <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
      </svg>
    </div>
  );
});

CoffeeIcon.displayName = "CoffeeIcon";

export { CoffeeIcon };
