const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));

  if (url === "https://api.exa.ai/search") {
    return new Response(JSON.stringify({
      results: [{
        title: "Security test fixture",
        url: "https://elias-test.invalid/article",
        highlights: ["Mocked source text for an authenticated search."],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (url.startsWith("https://api.github.com/repos/")) {
    const isAuthenticated = Boolean(headers.get("authorization"));
    return new Response(JSON.stringify(isAuthenticated
      ? { default_branch: "server-token-private", private: true, zipball_url: "https://private.invalid/archive" }
      : { default_branch: "main", private: false, zipball_url: "https://api.github.com/public/archive" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (url === "https://elias-test.invalid/article") {
    return new Response("<html><body><h1>Fixture source</h1><p>Public test article content.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return originalFetch(input, init);
};
