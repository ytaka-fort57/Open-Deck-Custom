import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, openDeck, sectionIdForType } from "./fixtures/deck.mjs";

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
