import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getAccessToken: mocks.getAccessToken } }),
}));

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

describe("gscClient", () => {
  beforeEach(() => {
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue({ accessToken: "tok_123" });
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists sites with a bearer token", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        siteEntry: [{ siteUrl: "https://x/", permissionLevel: "siteOwner" }],
      }),
    );
    const { createGscClient } = await import("./gscClient");
    const sites = await createGscClient({ userId: "u1" }).listSites();

    expect(sites).toHaveLength(1);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok_123" });
  });

  it("targets the selected Better Auth grant by Google sub", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ siteEntry: [] }));
    const { createGscClient } = await import("./gscClient");

    await createGscClient({
      userId: "u1",
      gscAccountId: "google-sub-a",
    }).listSites();

    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      body: {
        providerId: "google-search-console",
        userId: "u1",
        accountId: "google-sub-a",
      },
    });
  });

  it("omits accountId for the legacy null-account fallback", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ siteEntry: [] }));
    const { createGscClient } = await import("./gscClient");

    await createGscClient({ userId: "u1" }).listSites();

    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      body: { providerId: "google-search-console", userId: "u1" },
    });
  });

  it("fetches the Google account email from userinfo", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ email: "client@example.com" }),
    );
    const { createGscClient } = await import("./gscClient");

    const email = await createGscClient({
      userId: "u1",
      gscAccountId: "google-sub-a",
    }).getUserInfoEmail();

    expect(email).toBe("client@example.com");
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://openidconnect.googleapis.com/v1/userinfo");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok_123" });
  });

  it("encodes the siteUrl in the searchAnalytics path (both property forms)", async () => {
    mocks.fetch.mockImplementation(async () => jsonResponse({ rows: [] }));
    const { createGscClient } = await import("./gscClient");
    const client = createGscClient({ userId: "u1" });

    await client.querySearchAnalytics("sc-domain:example.com", {
      startDate: "2026-01-01",
      endDate: "2026-01-28",
    });
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
    );

    await client.querySearchAnalytics("https://example.com/", {
      startDate: "2026-01-01",
      endDate: "2026-01-28",
    });
    expect(mocks.fetch.mock.calls[1][0]).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query",
    );
  });

  it("posts to the URL Inspection endpoint and returns the result", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        inspectionResult: {
          indexStatusResult: { verdict: "PASS", coverageState: "Indexed" },
        },
      }),
    );
    const { createGscClient } = await import("./gscClient");
    const result = await createGscClient({ userId: "u1" }).inspectUrl(
      "sc-domain:example.com",
      "https://example.com/post",
      "en-US",
    );

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe(
      "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok_123" });
    const body = init?.body;
    const payload =
      typeof body === "string" ? (JSON.parse(body) as unknown) : null;
    expect(payload).toEqual({
      siteUrl: "sc-domain:example.com",
      inspectionUrl: "https://example.com/post",
      languageCode: "en-US",
    });
    expect(result?.indexStatusResult?.verdict).toBe("PASS");
  });

  it("maps 403 to a no-access GscApiError", async () => {
    mocks.fetch.mockImplementation(async () =>
      jsonResponse({ error: "forbidden" }, 403),
    );
    const { createGscClient, GscApiError } = await import("./gscClient");
    await expect(
      createGscClient({ userId: "u1" }).listSites(),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createGscClient({ userId: "u1" }).listSites(),
    ).rejects.toBeInstanceOf(GscApiError);
  });

  it("maps 429 to a rate-limit GscApiError", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    const { createGscClient } = await import("./gscClient");
    await expect(
      createGscClient({ userId: "u1" }).listSites(),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("throws GscTokenError when no access token can be minted", async () => {
    mocks.getAccessToken.mockRejectedValue(new Error("revoked"));
    const { createGscClient, GscTokenError } = await import("./gscClient");
    await expect(
      createGscClient({ userId: "u1" }).listSites(),
    ).rejects.toBeInstanceOf(GscTokenError);
  });
  it("preserves native aggregation and incomplete-data metadata", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        rows: [],
        responseAggregationType: "byPage",
        metadata: { first_incomplete_date: "2026-10-04" },
      }),
    );
    const { createGscClient } = await import("./gscClient");
    const result = await createGscClient({
      userId: "u1",
    }).querySearchAnalyticsReport("sc-domain:example.com", {
      startDate: "2026-09-06",
      endDate: "2026-10-03",
      aggregationType: "byPage",
      dataState: "final",
    });
    expect(result).toEqual({
      rows: [],
      responseAggregationType: "byPage",
      metadata: { first_incomplete_date: "2026-10-04" },
    });
    const body = mocks.fetch.mock.calls[0][1]?.body;
    if (typeof body !== "string")
      throw new Error("Expected a JSON request body");
    expect(JSON.parse(body)).toMatchObject({
      aggregationType: "byPage",
      dataState: "final",
    });
  });

  it("keeps the legacy row-only client contract", async () => {
    const rows = [
      { keys: ["MOBILE"], clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
    ];
    mocks.fetch.mockResolvedValue(
      jsonResponse({ rows, responseAggregationType: "byPage" }),
    );
    const { createGscClient } = await import("./gscClient");
    expect(
      await createGscClient({ userId: "u1" }).querySearchAnalytics(
        "https://example.com/",
        { startDate: "2026-09-06", endDate: "2026-10-03" },
      ),
    ).toEqual(rows);
  });

  it("does not invent absent response metadata", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({}));
    const { createGscClient } = await import("./gscClient");
    expect(
      await createGscClient({ userId: "u1" }).querySearchAnalyticsReport(
        "sc-domain:example.com",
        { startDate: "2026-09-06", endDate: "2026-10-03" },
      ),
    ).toEqual({ rows: [] });
  });

  it("reads native sitemap counts without deprecated indexed values", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        sitemap: [
          {
            path: "https://example.com/sitemap.xml",
            errors: "0",
            isPending: false,
            contents: [
              { type: "web", submitted: "9007199254740993", indexed: "0" },
            ],
          },
        ],
      }),
    );
    const { createGscClient } = await import("./gscClient");
    const result = await createGscClient({
      userId: "u1",
      gscAccountId: "sub-a",
    }).getSitemaps("sc-domain:example.com");
    expect(result).toEqual([
      {
        path: "https://example.com/sitemap.xml",
        errors: "0",
        isPending: false,
        contents: [{ type: "web", submitted: "9007199254740993" }],
      },
    ]);
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps",
    );
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      body: undefined,
    });
  });

  it("encodes exact sitemap and prefix property as path components", async () => {
    const url = "https://example.com/sitemap.xml?edition=a&b=2";
    mocks.fetch.mockResolvedValue(jsonResponse({ path: url }));
    const { createGscClient } = await import("./gscClient");
    expect(
      await createGscClient({ userId: "u1" }).getSitemaps(
        "https://example.com/",
        url,
      ),
    ).toEqual([{ path: url }]);
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("https://example.com/")}/sitemaps/${encodeURIComponent(url)}`,
    );
  });

  it("returns empty sitemap lists but preserves API failures", async () => {
    const { createGscClient } = await import("./gscClient");
    const client = createGscClient({ userId: "u1" });
    mocks.fetch.mockResolvedValue(jsonResponse({}));
    expect(await client.getSitemaps("sc-domain:example.com")).toEqual([]);
    mocks.fetch.mockResolvedValue(jsonResponse({}, 403));
    await expect(
      client.getSitemaps("sc-domain:example.com"),
    ).rejects.toMatchObject({ status: 403 });
    mocks.fetch.mockResolvedValue(jsonResponse({}, 404));
    await expect(
      client.getSitemaps(
        "sc-domain:example.com",
        "https://example.com/missing.xml",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects malformed native sitemap responses", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        sitemap: [{ path: "https://example.com/sitemap.xml", errors: -1 }],
      }),
    );
    const { createGscClient } = await import("./gscClient");
    await expect(
      createGscClient({ userId: "u1" }).getSitemaps("sc-domain:example.com"),
    ).rejects.toThrow();
  });
});
