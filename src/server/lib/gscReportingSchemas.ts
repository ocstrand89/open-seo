import { z } from "zod";

const countSchema = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative(),
]);

// Google serializes int64 counts as strings. Missing counts stay missing;
// contents.indexed is deprecated and intentionally omitted.
export const gscSitemapSchema = z.object({
  path: z.string(),
  lastSubmitted: z.string().optional(),
  lastDownloaded: z.string().optional(),
  isPending: z.boolean().optional(),
  isSitemapsIndex: z.boolean().optional(),
  type: z.string().optional(),
  warnings: countSchema.optional(),
  errors: countSchema.optional(),
  contents: z
    .array(
      z.object({
        type: z.string().optional(),
        submitted: countSchema.optional(),
      }),
    )
    .optional(),
});
export type GscSitemap = z.infer<typeof gscSitemapSchema>;

export const searchAnalyticsResponseSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).optional(),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number(),
        position: z.number(),
      }),
    )
    .default([]),
  responseAggregationType: z.string().optional(),
  metadata: z
    .object({
      first_incomplete_date: z.string().optional(),
      first_incomplete_hour: z.string().optional(),
    })
    .optional(),
});
export type GscSearchAnalyticsResponse = z.infer<
  typeof searchAnalyticsResponseSchema
>;
