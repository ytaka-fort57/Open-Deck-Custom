import { test as base, chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installXRoutes } from "./x-routes.mjs";

const extensionPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function extensionWorker(context) {
    return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function storagePage(context, extensionId) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/profile_debug.html`);
    await page.waitForLoadState("domcontentloaded");
    return page;
}

export const test = base.extend({
    extensionSession: async ({}, use, testInfo) => {
        const userDataDir = await mkdtemp(join(tmpdir(), "open-deck-e2e-"));
        const context = await chromium.launchPersistentContext(userDataDir, {
            channel: "chromium",
            headless: testInfo.project.use.headless ?? true,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
            locale: "ja-JP",
            timezoneId: "Asia/Tokyo",
            viewport: { width: 1440, height: 900 },
        });
        const errors = [];
        context.on("weberror", (webError) => {
            errors.push(`pageerror: ${webError.error().message}`);
        });
        context.on("console", (message) => {
            if (message.type() === "error") errors.push(`console: ${message.text()}`);
        });
        const routes = await installXRoutes(context);
        const worker = await extensionWorker(context);
        const extensionId = new URL(worker.url()).hostname;

        const storage = {
            async set(items) {
                const page = await storagePage(context, extensionId);
                try {
                    await page.evaluate((value) => chrome.storage.local.set(value), items);
                } finally {
                    await page.close();
                }
            },
            async get(keys = null) {
                const page = await storagePage(context, extensionId);
                try {
                    return await page.evaluate((value) => chrome.storage.local.get(value), keys);
                } finally {
                    await page.close();
                }
            },
        };

        try {
            await use({ context, extensionId, worker, storage, errors, ...routes });
        } finally {
            if (testInfo.status !== testInfo.expectedStatus) {
                await testInfo.attach("e2e-diagnostics", {
                    body: Buffer.from(JSON.stringify({
                        errors,
                        blockedRequests: routes.blockedRequests,
                    }, null, 2)),
                    contentType: "application/json",
                });
            }
            await context.close();
            await rm(userDataDir, { recursive: true, force: true });
        }
    },
});

export { expect };
