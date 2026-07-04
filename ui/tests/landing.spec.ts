import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, chromium, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

/* The front-facing DEMONSTRATION site (CuboCruise-style). Asserts the marketing page renders its
 * sections, the live-demo CTA points at the demo build, and the FAQ accordion expands. Runs on
 * the real `dist-landing` build. Precondition: the suite pretest builds it (`vite build --mode
 * landing`). Blueprint: docs/plans/2026-06-26-hades-landing-page.md. */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let server: PreviewServer;
let browser: Browser;
let appUrl: string;

test.beforeAll(async () => {
  // Preview the landing build (its own out dir + landing.html entry).
  server = await preview({
    root: ROOT,
    build: { outDir: "dist-landing" },
    preview: { port: 5284 },
  });
  appUrl = server.resolvedUrls!.local[0];
  browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
});

test.afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

test("the landing page renders the hero, sections, real metrics, and a demo CTA", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${appUrl}landing.html`, { waitUntil: "networkidle" });

  // hero display word + the what-it-is line
  await expect(page.getByRole("heading", { level: 1, name: "HADES" })).toBeVisible();
  await expect(page.getByText(/ground-control station for post-hurricane/i).first()).toBeVisible();

  // the live-demo CTA points at the demo build (the relative ./index.html)
  const demo = page.getByRole("link", { name: /live demo/i }).first();
  await expect(demo).toHaveAttribute("href", /index\.html|\.\//);

  // section headings + the real, honest metric figures (scroll-revealed) — scroll the proof
  // section into view, then assert the metric display figures (not the prose that also cites them)
  await page.locator("#proof").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: /measured, not claimed/i })).toBeVisible();
  await expect(page.locator(".mono.display", { hasText: "0.55" })).toBeVisible();
  await expect(page.locator(".mono.display", { hasText: "22.4" })).toBeVisible();
});

test("the FAQ accordion expands an answer on click", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${appUrl}landing.html`, { waitUntil: "networkidle" });

  const q = page.getByRole("button", { name: /does it work without a connection/i });
  await q.scrollIntoViewIfNeeded();
  await expect(q).toHaveAttribute("aria-expanded", "false");
  await q.click();
  await expect(q).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/runs entirely on-device with the network off/i)).toBeVisible();
});
