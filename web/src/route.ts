import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  addEventListener("popstate", onChange);
  return () => removeEventListener("popstate", onChange);
};

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname);

export const navigate = (path: string, { replace = false } = {}) => {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
};
