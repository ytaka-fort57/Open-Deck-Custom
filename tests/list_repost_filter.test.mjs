import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadFilter(){
    const context = { URL, console: { warn() {} } };
    context.window = {};
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/list_repost_filter.js", "utf8"), context);
    return context.window.opd_custom_list_repost_filter;
}

function link(href){
    return { getAttribute: (name) => name === "href" ? href : null };
}

function scope(hrefs, textContent = "", firstSpanText = ""){
    return {
        querySelector: (selector) => {
            if(selector === "span" && firstSpanText !== ""){
                return { textContent: firstSpanText };
            }
            if(selector === "a[href]" && hrefs.length > 0){
                return { getAttribute: (name) => name === "href" ? hrefs[0] : null, textContent: firstSpanText };
            }
            return null;
        },
        querySelectorAll: () => hrefs.map(link),
        textContent,
    };
}

function article({reposter, author, reposterName = "", authorName = "", context = "reposted", textContent = ""} = {}){
    const social = reposter == null && reposterName === "" ? null : scope(
        reposter == null ? [] : [reposter],
        context,
        reposterName
    );
    const name = author == null && authorName === "" ? null : scope(
        author == null ? [] : [author],
        "",
        authorName
    );
    return {
        textContent,
        querySelector: (selector) => {
            if(selector === '[data-testid="socialContext"]') return social;
            if(selector === '[data-testid="User-Name"]') return name;
            return null;
        },
    };
}

function replyArticle({target = "Alice", context = "Replying to"} = {}){
    const targetLink = {
        getAttribute: (name) => name === "href" ? `/${target}` : null,
        textContent: `@${target}`,
        parentElement: null,
    };
    const contextNode = {
        textContent: `${context} @${target}`,
        parentElement: null,
    };
    targetLink.parentElement = contextNode;
    return {
        querySelectorAll: (selector) => selector === "a[href]"
            ? [targetLink]
            : selector === "*" ? [contextNode] : [],
    };
}

function textOnlyReplyArticle(textContent){
    return {
        querySelectorAll: (selector) => selector === "*"
            ? [{ textContent }]
            : [],
    };
}

test("list path detection is limited to list feeds", () => {
    const filter = loadFilter();
    assert.equal(filter.is_list_path("/i/lists/123"), true);
    assert.equal(filter.is_list_path("/i/lists/123/"), true);
    assert.equal(filter.is_list_path("/home"), false);
    assert.equal(filter.is_list_path("/i/lists/123/members"), false);
});

test("home list tabs are active while recommendations and following are not", () => {
    const filter = loadFilter();
    const selected = (textContent) => ({
        textContent,
        querySelectorAll: () => [],
    });
    const doc = (textContent) => ({
        querySelector: () => selected(textContent),
    });

    assert.equal(filter.is_home_list_tab(doc("おすすめ")), false);
    assert.equal(filter.is_home_list_tab(doc("フォロー中")), false);
    assert.equal(filter.is_home_list_tab(doc("暇空茜")), true);
});

test("profile keys ignore non-profile routes and normalize case", () => {
    const filter = loadFilter();
    assert.equal(filter.profile_key_from_href("/Alice"), "alice");
    assert.equal(filter.profile_key_from_href("https://x.com/Alice"), "alice");
    assert.equal(filter.profile_key_from_href("/home"), null);
    assert.equal(filter.profile_key_from_href("/Alice/status/123"), null);
});

test("home path detection includes the normal home timeline", () => {
    const filter = loadFilter();
    assert.equal(filter.is_home_path("/home"), true);
    assert.equal(filter.is_home_path("/home/"), true);
    assert.equal(filter.is_home_path("/i/lists/123"), false);
    assert.equal(filter.should_apply_reply_filter("home", "/home", {}), true);
    assert.equal(filter.should_apply_reply_filter("explore", "/home", {}), false);
});

test("current profile is read from X's profile navigation link", () => {
    const filter = loadFilter();
    const profileLink = {
        getAttribute: (name) => name === "href" ? "/Alice" : null,
    };
    const doc = {
        querySelectorAll: (selector) => selector === 'a[data-testid="AppTabBar_Profile_Link"]'
            ? [profileLink]
            : [],
    };
    assert.equal(filter.current_profile_key(doc), "alice");
    assert.equal(filter.current_profile_key({ querySelectorAll: () => [] }), null);
});

test("only a repost by the original author is classified as a self repost", () => {
    const filter = loadFilter();
    assert.equal(filter.is_same_author_repost(article({ reposter: "/Alice", author: "/Alice" })), true);
    assert.equal(filter.is_same_author_repost(article({ reposter: "/Alice", author: "/Bob" })), false);
    assert.equal(filter.is_same_author_repost(article({ reposter: "/Alice", author: "/Alice", context: "liked" })), false);
    assert.equal(filter.is_same_author_repost(article({ reposterName: "暇空茜", authorName: "暇空茜" })), true);
    assert.equal(filter.is_same_author_repost(article({ reposterName: "暇空茜", authorName: "別の作者" })), false);
    assert.equal(filter.is_same_author_repost(article({ reposter: null, author: "/Alice" })), false);
});

test("only replies addressed to the current profile are classified for hiding", () => {
    const filter = loadFilter();
    assert.equal(filter.reply_target_key(replyArticle({ target: "Alice" })), "alice");
    assert.equal(filter.is_reply_to_current_user(replyArticle({ target: "Alice" }), "alice"), true);
    assert.equal(filter.is_reply_to_current_user(replyArticle({ target: "Bob" }), "alice"), false);
    assert.equal(filter.is_reply_to_current_user(replyArticle({ target: "Alice", context: "通常の投稿" }), "alice"), false);
    assert.equal(filter.is_reply_to_current_user(replyArticle({ target: "Alice" }), ""), false);
});

test("reply handle fallback is fail-open when the target link is unavailable", () => {
    const filter = loadFilter();
    assert.equal(filter.is_reply_to_current_user(
        textOnlyReplyArticle("返信先 @Alice"),
        "alice"
    ), true);
    assert.equal(filter.is_reply_to_current_user(
        textOnlyReplyArticle("返信先 @AliceExtra"),
        "alice"
    ), false);
    assert.equal(filter.is_reply_to_current_user(
        textOnlyReplyArticle("通常の投稿 @Alice"),
        "alice"
    ), false);
});

test("paid partnership posts are classified independently of repost metadata", () => {
    const filter = loadFilter();
    assert.equal(filter.has_paid_partnership(article({ textContent: "有料パートナーシップ" })), true);
    assert.equal(filter.has_paid_partnership(article({ textContent: "Paid partnership" })), true);
    assert.equal(filter.has_paid_partnership(article({ textContent: "通常の投稿" })), false);
    assert.equal(filter.has_paid_partnership({}), false);
});
