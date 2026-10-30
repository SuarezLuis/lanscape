import { Anchor, Card, Loader, Text, Typography } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REPO = "https://github.com/SuarezLuis/lanscape";
const HELP_URL = "https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/HELP.md";

// Fetched from GitHub so the help stays current between releases; the browser fetches it, not the server
export const HelpPage = () => {
  const help = useQuery({
    queryKey: ["help"],
    queryFn: async () => {
      const response = await fetch(HELP_URL);
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      return response.text();
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return (
    <Card withBorder padding="lg" radius="md">
      {help.isPending && <Loader size="sm" />}
      {help.isError && (
        <Text>
          Couldn't load the help from GitHub ({help.error.message}). Read it at{" "}
          <Anchor href={`${REPO}/blob/master/docs/HELP.md`} target="_blank">
            {REPO.replace("https://", "")}
          </Anchor>
          .
        </Text>
      )}
      {help.data && (
        <Typography>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
          >
            {help.data}
          </Markdown>
        </Typography>
      )}
    </Card>
  );
};
