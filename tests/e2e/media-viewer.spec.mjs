import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems, storageItems, TWO_TIMELINE_COLUMNS } from "./fixtures/storage-fixtures.mjs";
import { columnLabel, frameForSection, openDeck, rackSections, sectionIdForType } from "./fixtures/deck.mjs";

const mediaUrl = (name) => `https://pbs.twimg.com/media/${name}.jpg?name=orig`;

//カラムのメディアはiframe側のhelperがReact propsから拾い、tokenを添えて
//デッキ本体へ渡す。propsの選び方はNodeテストで固定済みなので、ここでは
//注入・token・ビューアー表示・キー操作という経路の方を見る。
test("quoted media opens the deck viewer and answers keyboard operations", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    const listFrame = frameForSection(page, await sectionIdForType(page, "explore"));
    const viewer = page.locator("#opd_media_viewer");
    const viewerMedia = viewer.locator("[data-media]");

    //引用内のメディアは、引用元ではなく引用側の一覧で開く
    await listFrame.locator("#opd_fixture_quote_image").click();
    await expect(viewer).toBeVisible();
    await expect(viewerMedia).toHaveAttribute("src", mediaUrl("opd-e2e-quote-2"));
    await expect(viewer.locator("[data-media-next]")).toBeDisabled();
    await expect(viewer.locator("[data-media-forward]")).toBeEnabled();

    await page.keyboard.press("ArrowLeft");
    await expect(viewerMedia).toHaveAttribute("src", mediaUrl("opd-e2e-quote-1"));
    await expect(viewer.locator("[data-media-forward]")).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    //引用でないメディアは、クリックした画像の位置で開く
    await listFrame.locator("#opd_fixture_direct_image").click();
    await expect(viewer).toBeVisible();
    await expect(viewerMedia).toHaveAttribute("src", mediaUrl("opd-e2e-direct-1"));
    await expect(viewer.locator("[data-media-forward]")).toBeDisabled();

    await page.keyboard.press("ArrowRight");
    await expect(viewerMedia).toHaveAttribute("src", mediaUrl("opd-e2e-direct-2"));
    await expect(viewer.locator("[data-media-next]")).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("quoted and direct media from both timeline columns open in the shared deck viewer", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems([TWO_TIMELINE_COLUMNS]));
    const timelineSections = (await rackSections(page)).filter((section) => section.type === "home");
    expect(timelineSections).toHaveLength(2);

    await page.evaluate(() => {
        window.opdE2EMediaEvents = [];
        document.addEventListener("opd_send_media_info", (event) => {
            window.opdE2EMediaEvents.push(JSON.parse(event.detail));
        });
    });

    const viewer = page.locator("#opd_media_viewer");
    for (const section of timelineSections) {
        const frame = frameForSection(page, section.id);

        await frame.locator("#opd_fixture_quote_image").click();
        await expect(viewer).toBeVisible();
        await expect(viewer.locator("[data-media]")).toHaveAttribute("src", mediaUrl("opd-e2e-quote-2"));
        await expect(columnLabel(frame)).toHaveAttribute("aria-label", "Home");
        await page.keyboard.press("Escape");
        await expect(viewer).toHaveCount(0);

        await frame.locator("#opd_fixture_direct_image").click();

        await expect(viewer).toBeVisible();
        await expect(viewer.locator("[data-media]")).toHaveAttribute("src", mediaUrl("opd-e2e-direct-1"));
        await expect(columnLabel(frame)).toHaveAttribute("aria-label", "Home");

        await page.keyboard.press("Escape");
        await expect(viewer).toHaveCount(0);
    }

    const mediaEvents = await page.evaluate(() => window.opdE2EMediaEvents);
    expect(mediaEvents).toHaveLength(4);
    expect(mediaEvents[0].token).toBe(mediaEvents[1].token);
    expect(mediaEvents[2].token).toBe(mediaEvents[3].token);
    expect(mediaEvents[0].token).not.toBe(mediaEvents[2].token);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
