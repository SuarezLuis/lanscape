import { Anchor, Card, Loader, Text, Typography } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REPO = "https://github.com/SuarezLuis/lanscape";
const RAW = "https://raw.githubusercontent.com/SuarezLuis/lanscape/master";

// Relative links in the repo's markdown ("docs/HELP.md") point at GitHub, not at pages in this app; images need the
// raw file, links the page view
const resolveLink = (url: string, key: string) => {
  if (/^([a-z]+:|#)/i.test(url)) return url;
  const path = url.replace(/^\.?\//, "");
  return key === "src" ? `${RAW}/${path}` : `${REPO}/blob/master/${path}`;
};

/**
 * Renders a markdown file from the repo's master branch. Fetched by the browser, so the Help and About pages stay
 * current between releases.
 */
export const GitHubDoc = ({ path }: { path: string }) => {
  const doc = useQuery({
    queryKey: ["github-doc", path],
    queryFn: async () => {
      const response = await fetch(`${RAW}/${path}`);
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      return response.text();
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  return (
    <Card withBorder padding="lg" radius="md">
      {doc.isPending && <Loader size="sm" />}
      {doc.isError && (
        <Text>
          Couldn't load this page from GitHub ({doc.error.message}). Read it at{" "}
          <Anchor href={`${REPO}/blob/master/${path}`} target="_blank">
            {`github.com/SuarezLuis/lanscape/${path}`}
          </Anchor>
          .
        </Text>
      )}
      {doc.data && (
        <Typography>
          <Markdown
            remarkPlugins={[remarkGfm]}
            urlTransform={resolveLink}
            components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
          >
            {doc.data}
          </Markdown>
        </Typography>
      )}
    </Card>
  );
};
