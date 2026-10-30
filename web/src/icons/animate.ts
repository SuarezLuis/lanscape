import { type ComponentType, type Ref, useRef } from "react";

type IconHandle = { startAnimation: () => void; stopAnimation: () => void };
export type AnimatedIcon = ComponentType<{ size?: number; ref?: Ref<IconHandle> }>;

// Plays the icon's animation while its whole parent (nav link, button, segment) is hovered
export const useIconHover = () => {
  const ref = useRef<IconHandle>(null);
  return {
    ref,
    hover: {
      onMouseEnter: () => ref.current?.startAnimation(),
      onMouseLeave: () => ref.current?.stopAnimation(),
    },
  };
};
