import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import { MantineProvider } from "@mantine/core";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TRPCProvider, trpcClient } from "./trpc";

// A 401 anywhere means the session ended (expired, or signed out elsewhere): recheck, which shows the sign-in screen
const signedOut = (error: unknown) => {
  if ((error as { data?: { code?: string } }).data?.code === "UNAUTHORIZED") {
    void queryClient.invalidateQueries({ queryKey: [["auth", "status"]] });
  }
};
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signedOut }),
  mutationCache: new MutationCache({ onError: signedOut }),
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

createRoot(root).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <App />
        </TRPCProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
