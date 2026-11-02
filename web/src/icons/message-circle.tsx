// Message-circle icon from lucide (ISC), animated like the lucide-animated set: it wiggles on hover
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useImperativeHandle } from "react";

interface MessageCircleIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MessageCircleIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const MessageCircleIcon = forwardRef<MessageCircleIconHandle, MessageCircleIconProps>(({ size = 28, ...props }, ref) => {
  const controls = useAnimation();
  useImperativeHandle(ref, () => ({
    startAnimation: () => controls.start({ rotate: [0, -8, 8, 0], transition: { duration: 0.5, ease: "easeInOut" } }),
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
        <motion.g animate={controls} style={{ originX: "50%", originY: "50%" }}>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </motion.g>
      </svg>
    </div>
  );
});

MessageCircleIcon.displayName = "MessageCircleIcon";

export { MessageCircleIcon };
