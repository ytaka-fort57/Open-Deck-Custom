import { test, expect } from "./fixtures/extension-context.mjs";
import { column, storageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, openDeck, sectionIdForType } from "./fixtures/deck.mjs";

const POST_COLUMNS = [
    column("main_bar_empty_column"),
    column("post"),
    column("empty_column"),
];

async function openPostColumn(extensionSession) {
    const { context, storage } = extensionSession;
    const page = await openDeck(context, storage, storageItems([POST_COLUMNS]));
    const sectionId = await sectionIdForType(page, "post");
    const frame = frameForSection(page, sectionId);
    const editor = frame.locator('[contenteditable="true"][data-testid*="tweetTextarea"]');
    const reviewButton = frame.locator("#opd_post_text_review");
    await expect(reviewButton).toHaveCount(1);
    return { page, frame, editor, reviewButton };
}

async function enterReviewText(editor, reviewButton, text) {
    await editor.fill(text);
    await expect(reviewButton).not.toHaveAttribute("disabled", "");
}

test("text review opens fixture results and applies every suggestion to the post editor", async ({ extensionSession }) => {
    const { blockedRequests, errors, textReviewRequests } = extensionSession;
    const { frame, editor, reviewButton } = await openPostColumn(extensionSession);

    await enterReviewText(editor, reviewButton, "abc");
    await reviewButton.click();

    const panel = frame.locator(".opd_text_review_panel");
    await expect(panel.locator(".opd_text_review_result")).toBeVisible();
    await expect(panel.locator(".opd_text_review_indication_switch")).toHaveCount(2);
    await panel.locator("#opd_text_review_apply_all").click();
    await expect(editor).toHaveText("aBC");

    expect(textReviewRequests).toEqual([{ text: "abc" }]);
    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("text review shows a failure when the fixture endpoint rejects the request", async ({ extensionSession }) => {
    const { blockedRequests, textReviewRequests } = extensionSession;
    const { frame, editor, reviewButton } = await openPostColumn(extensionSession);

    await enterReviewText(editor, reviewButton, "fixture failure");
    await reviewButton.click();

    await expect(frame.locator(".opd_text_review_panel")).toContainText("校正に失敗しました");
    await expect(editor).toHaveText("fixture failure");
    expect(textReviewRequests).toEqual([{ text: "fixture failure" }]);
    expect(blockedRequests, "fixture外network request").toEqual([]);
});
