import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscApiError, GscNotConnectedError } from "@/server/lib/gscErrors";
import * as searchConsoleTools from "./search-console-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  hasSelfHostedGoogleOAuthConfig: vi.fn(),
  GscService: {
    getPerformance: vi.fn(),
    inspectUrls: vi.fn(),
    getSitemaps: vi.fn(),
  },
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));
vi.mock("@/server/features/google/oauth-config", () => ({
  hasSelfHostedGoogleOAuthConfig: mocks.hasSelfHostedGoogleOAuthConfig,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: mocks.GscService,
}));
const toolContext = makeToolContext();

describe("native GSC reporting MCP extension", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.hasSelfHostedGoogleOAuthConfig.mockResolvedValue(false);
  });

  it("returns the resolved request and Google aggregation without leaking connector email", async () => {
    mocks.GscService.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: "private@example.com",
      request: {
        startDate: "2026-09-06",
        endDate: "2026-10-03",
        dimensions: ["page", "device"],
        aggregationType: "byPage",
        dataState: "final",
        rowLimit: 1000,
      },
      rows: [],
      responseAggregationType: "byPage",
      metadata: { first_incomplete_date: "2026-10-04" },
    });
    const result =
      await searchConsoleTools.getSearchConsolePerformanceTool.handler(
        {
          projectId: "project_1",
          aggregationType: "byPage",
          dimensions: ["page", "device"],
        },
        toolContext,
      );
    expect(result.structuredContent).toMatchObject({
      responseAggregationType: "byPage",
      request: { aggregationType: "byPage", dataState: "final" },
      dataMetadata: { first_incomplete_date: "2026-10-04" },
    });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  it.each([
    { dimensions: ["page" as const] },
    {
      filters: [
        {
          dimension: "page" as const,
          operator: "equals" as const,
          expression: "https://example.com/",
        },
      ],
    },
    { type: "discover" as const },
    { type: "googleNews" as const },
  ])(
    "rejects invalid byProperty combinations before Google call",
    async (extra) => {
      const result =
        await searchConsoleTools.getSearchConsolePerformanceTool.handler(
          {
            projectId: "project_1",
            aggregationType: "byProperty",
            ...extra,
          },
          toolContext,
        );
      expect(result.structuredContent).toMatchObject({
        ok: false,
        reason: "invalid_request",
      });
      expect(mocks.GscService.getPerformance).not.toHaveBeenCalled();
    },
  );

  it("reads the exact sitemap without inventing missing counts", async () => {
    mocks.GscService.getSitemaps.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      sitemaps: [{ path: "https://example.com/sitemap.xml", isPending: true }],
    });
    const result =
      await searchConsoleTools.getSearchConsoleSitemapsTool.handler(
        {
          projectId: "project_1",
          sitemapUrl: "https://example.com/sitemap.xml",
        },
        toolContext,
      );
    expect(mocks.GscService.getSitemaps).toHaveBeenCalledWith({
      projectId: "project_1",
      sitemapUrl: "https://example.com/sitemap.xml",
    });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      rowCount: 1,
      truncated: false,
      sitemaps: [{ isPending: true }],
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain('"errors":');
    const first = result.content[0];
    expect(first.type === "text" && first.text).toContain(
      "errors: unavailable",
    );
  });

  it("reports empty lists and explicit list truncation", async () => {
    mocks.GscService.getSitemaps.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      sitemaps: [],
    });
    const empty = await searchConsoleTools.getSearchConsoleSitemapsTool.handler(
      { projectId: "project_1" },
      toolContext,
    );
    expect(empty.structuredContent).toMatchObject({
      ok: true,
      rowCount: 0,
      totalSitemaps: 0,
      truncated: false,
    });
    mocks.GscService.getSitemaps.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      sitemaps: Array.from({ length: 101 }, (_, i) => ({
        path: `https://example.com/${i}.xml`,
      })),
    });
    const truncated =
      await searchConsoleTools.getSearchConsoleSitemapsTool.handler(
        { projectId: "project_1" },
        toolContext,
      );
    expect(truncated.structuredContent).toMatchObject({
      rowCount: 100,
      totalSitemaps: 101,
      truncated: true,
    });
  });

  it("gates sitemap reads on the token organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);
    await expect(
      searchConsoleTools.getSearchConsoleSitemapsTool.handler(
        { projectId: "foreign" },
        toolContext,
      ),
    ).rejects.toThrow();
    expect(mocks.GscService.getSitemaps).not.toHaveBeenCalled();
  });

  it("blocks unconfigured self-hosted sitemap reads", async () => {
    mocks.isHostedServerAuthMode.mockResolvedValue(false);
    const result =
      await searchConsoleTools.getSearchConsoleSitemapsTool.handler(
        { projectId: "project_1" },
        toolContext,
      );
    expect(result.structuredContent).toMatchObject({
      reason: "gsc_oauth_not_configured",
    });
    expect(mocks.GscService.getSitemaps).not.toHaveBeenCalled();
  });

  it.each([
    new GscNotConnectedError("project_1"),
    new GscApiError(403, "no access"),
    new GscApiError(429, "rate limited"),
  ])("surfaces sitemap connection/API errors", async (error) => {
    mocks.GscService.getSitemaps.mockRejectedValue(error);
    const result =
      await searchConsoleTools.getSearchConsoleSitemapsTool.handler(
        { projectId: "project_1" },
        toolContext,
      );
    expect(result.structuredContent).toMatchObject({
      ok: false,
      reason:
        error instanceof GscNotConnectedError ? "not_connected" : "api_error",
    });
  });
});
