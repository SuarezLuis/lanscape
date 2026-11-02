// Activity icon from lucide (ISC), animated like the lucide-animated set: the line redraws on hover
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useImperativeHandle } from "react";

interface ActivityIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ActivityIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ActivityIcon = forwardRef<ActivityIconHandle, ActivityIconProps>(({ size = 28, ...props }, ref) => {
  const controls = useAnimation();
  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start({ pathLength: [0, 1], transition: { duration: 0.6, ease: "easeInOut" } }),
    stopAnimation: () => controls.start({ pathLength: 1 }),
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
        <motion.path
          animate={controls}
          d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
        />
      </svg>
    </div>
  );
});

ActivityIcon.displayName = "ActivityIcon";

export { ActivityIcon };
