import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

//タイマーは手で進める。実時間の待ちに頼らない
function loadNudge(){
    const timers = new Map();
    let next_id = 1;
    const context = {
        setTimeout: (callback) => {
            const id = next_id++;
            timers.set(id, callback);
            return id;
        },
        clearTimeout: (id) => { timers.delete(id); },
    };
    context.window = {};
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/timeline_load_nudge.js", "utf8"), context);
    return {
        nudge: context.window.opd_custom_timeline_load_nudge,
        pending: () => timers.size,
        flush: () => {
            const callbacks = Array.from(timers.values());
            timers.clear();
            callbacks.forEach((callback) => callback());
        },
    };
}

function scrollDocument({ scrollHeight, scrollY, innerHeight, body = null }){
    const scrolls = [];
    const frames = [];
    let next_frame = 1;
    const removed = [];
    const doc = {
        scrollingElement: { scrollHeight },
        body,
        defaultView: {
            scrollY,
            innerHeight,
            scrollBy(_x, y) { scrolls.push(y); },
            requestAnimationFrame(callback) {
                const id = next_frame++;
                frames.push({ id, callback });
                return id;
            },
            cancelAnimationFrame(id) {
                const index = frames.findIndex((frame) => frame.id === id);
                if(index >= 0){
                    frames.splice(index, 1);
                }
            },
        },
        createElement: () => ({
            attributes: {},
            style: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            remove() { removed.push(this); },
        }),
    };
    return {
        scrolls,
        frames,
        removed,
        doc,
        flushFrames: () => {
            const pending = frames.splice(0, frames.length);
            pending.forEach((frame) => frame.callback());
        },
    };
}

test("the timeline counts as short only within one viewport of the bottom", () => {
    const { nudge } = loadNudge();
    assert.equal(nudge.is_near_bottom(scrollDocument({ scrollHeight: 3000, scrollY: 2100, innerHeight: 900 }).doc), true);
    assert.equal(nudge.is_near_bottom(scrollDocument({ scrollHeight: 3000, scrollY: 1200, innerHeight: 900 }).doc), true);
    assert.equal(nudge.is_near_bottom(scrollDocument({ scrollHeight: 3000, scrollY: 1199, innerHeight: 900 }).doc), false);
    assert.equal(nudge.is_near_bottom(scrollDocument({ scrollHeight: 3000, scrollY: 0, innerHeight: 0 }).doc), false);
    assert.equal(nudge.is_near_bottom({}), false);
});

test("newly hidden posts near the bottom move the scroll position by one pixel and restore it", () => {
    const { nudge, pending, flush } = loadNudge();
    const page = scrollDocument({ scrollHeight: 2000, scrollY: 1100, innerHeight: 900 });
    assert.equal(nudge.request(page.doc, [{}, {}]), true);
    //同じバースト内の2回目の要求はまとめる
    assert.equal(nudge.request(page.doc, [{}]), true);
    assert.equal(pending(), 1);
    assert.equal(page.scrolls.length, 0);
    flush();
    assert.deepEqual(page.scrolls, [-1]);
    page.flushFrames();
    assert.deepEqual(page.scrolls, [-1, 1]);
});

test("posts that were already hidden do not keep nudging", () => {
    const { nudge, pending, flush } = loadNudge();
    const page = scrollDocument({ scrollHeight: 2000, scrollY: 1100, innerHeight: 900 });
    const target = {};
    nudge.request(page.doc, [target]);
    flush();
    page.flushFrames();
    //1秒ごとの再適用で同じ投稿を隠し直しても、読み込みを促し続けない
    assert.equal(nudge.request(page.doc, [target]), false);
    assert.equal(nudge.request(page.doc, []), false);
    assert.equal(pending(), 0);
    assert.deepEqual(page.scrolls, [-1, 1]);
});

test("a timeline with room left to scroll is not nudged", () => {
    const { nudge, flush } = loadNudge();
    const page = scrollDocument({ scrollHeight: 8000, scrollY: 0, innerHeight: 900 });
    nudge.request(page.doc, [{}]);
    flush();
    assert.equal(page.scrolls.length, 0);
    assert.equal(page.frames.length, 0);
});

test("a collapsed timeline grows for one frame so a scroll can start", () => {
    const { nudge, flush } = loadNudge();
    const appended = [];
    const page = scrollDocument({
        scrollHeight: 400,
        scrollY: 0,
        innerHeight: 900,
        body: { appendChild: (node) => { appended.push(node); } },
    });
    nudge.request(page.doc, [{}]);
    flush();
    assert.equal(appended.length, 1);
    assert.equal(appended[0].attributes["data-opd-timeline-load-nudge"], "");
    assert.equal(appended[0].style.height, "502px");
    assert.deepEqual(page.scrolls, [1]);
    page.flushFrames();
    assert.deepEqual(page.scrolls, [1, -1]);
    assert.equal(page.removed.length, 1);
});

test("a pending nudge is cancelled when the column is disposed", () => {
    const { nudge, pending, flush } = loadNudge();
    const page = scrollDocument({ scrollHeight: 2000, scrollY: 1100, innerHeight: 900 });
    nudge.request(page.doc, [{}]);
    nudge.cancel(page.doc);
    assert.equal(pending(), 0);
    flush();
    assert.equal(page.scrolls.length, 0);
});

test("cancelling during the restore frame puts the scroll position back", () => {
    const { nudge, flush } = loadNudge();
    const page = scrollDocument({ scrollHeight: 2000, scrollY: 1100, innerHeight: 900 });
    nudge.request(page.doc, [{}]);
    flush();
    assert.deepEqual(page.scrolls, [-1]);
    nudge.cancel(page.doc);
    assert.deepEqual(page.scrolls, [-1, 1]);
    assert.equal(page.frames.length, 0);
    page.flushFrames();
    assert.deepEqual(page.scrolls, [-1, 1]);
});
