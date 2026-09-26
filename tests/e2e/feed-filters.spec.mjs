import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, openDeck, sectionIdForType } from "./fixtures/deck.mjs";

test("short-post filter hides a three-signal post and keeps a normal post visible", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());
    const homeFrame = frameForSection(page, await sectionIdForType(page, "home"));
    const filteredPost = homeFrame.locator("#opd_fixture_short_filtered");

    await expect(filteredPost).toHaveCount(1);
    await expect(filteredPost).toHaveClass(/opd_custom_short_post_filter_hidden/);
    await expect(filteredPost).toBeHidden();
    await expect(homeFrame.locator("#opd_fixture_short_visible")).toBeVisible();

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("list reply filter hides replies to the current profile and keeps other replies visible", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());
    const listFrame = frameForSection(page, await sectionIdForType(page, "explore"));
    const filteredReply = listFrame.locator("#opd_fixture_reply_filtered");

    await expect(filteredReply).toHaveCount(1);
    await expect(filteredReply).toHaveClass(/opd_custom_reply_to_current_user/);
    await expect(filteredReply).toBeHidden();
    await expect(listFrame.locator("#opd_fixture_reply_visible")).toBeVisible();

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
