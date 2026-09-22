import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pagesDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "pages");
const SCRIPT_PLACEHOLDER = /<!--opd-script:([a-z0-9._-]+)-->/g;
const fixtureByPath = new Map([
    ["/run-opdeck", "run-opdeck.html"],
    ["/home", "home.html"],
    ["/intent/tweet", "home.html"],
    ["/notifications", "notifications.html"],
    ["/explore", "explore.html"],
    ["/i/lists/42", "list.html"],
]);
//メディアビューアーが実際に読み込むURL。fixtureが渡したメディア以外は通さない
const mediaFixturePaths = new Set([
    "/media/opd-e2e-direct-1.jpg",
    "/media/opd-e2e-direct-2.jpg",
    "/media/opd-e2e-quote-1.jpg",
    "/media/opd-e2e-quote-2.jpg",
]);
const FIXTURE_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
);

async function readPage(filename){
    const html = await readFile(join(pagesDirectory, filename), "utf8");
    const scriptNames = Array.from(html.matchAll(SCRIPT_PLACEHOLDER), (match) => match[1]);
    const scripts = new Map();
    for (const name of scriptNames) {
        scripts.set(name, await readFile(join(pagesDirectory, name), "utf8"));
    }
    return html.replaceAll(SCRIPT_PLACEHOLDER, (_match, name) => scripts.get(name));
}

export async function installXRoutes(context) {
    const pages = new Map();
    const navigationCounts = new Map();
    const blockedRequests = [];
    for (const [path, filename] of fixtureByPath) {
        pages.set(path, await readPage(filename));
    }

    await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.protocol === "chrome-extension:" || url.protocol === "data:" || url.protocol === "blob:") {
            await route.continue();
            return;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            await route.continue();
            return;
        }
        if (url.hostname === "x.com" && request.isNavigationRequest() && pages.has(url.pathname)) {
            navigationCounts.set(url.pathname, (navigationCounts.get(url.pathname) ?? 0) + 1);
            await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                headers: {
                    "cache-control": "no-store",
                    "content-security-policy": "default-src 'self' 'unsafe-inline' data: chrome-extension: https://pbs.twimg.com",
                },
                body: pages.get(url.pathname),
            });
            return;
        }
        if (url.hostname === "pbs.twimg.com" && mediaFixturePaths.has(url.pathname)) {
            await route.fulfill({
                status: 200,
                contentType: "image/png",
                headers: { "cache-control": "no-store" },
                body: FIXTURE_PNG,
            });
            return;
        }
        blockedRequests.push(request.url());
        await route.abort("blockedbyclient");
    });

    return { navigationCounts, blockedRequests };
}
