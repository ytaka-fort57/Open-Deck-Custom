import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadHistory() {
    let timer_callback = null;
    let now = 1000;
    const context = {
        URL,
        console: { warn: () => {} },
        Date: { now: () => now },
        setInterval: (callback) => {
            timer_callback = callback;
            return 1;
        },
        clearInterval: () => {},
        window: {},
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/column_history.js", "utf8"), context);
    return {
        history: context.window.opd_custom_column_history,
        tick: () => timer_callback?.(),
        advance: (ms) => {
            now += ms;
        },
    };
}

function createFrame(initial_url, options = {}) {
    let href = initial_url;
    const route_state = { route: "current" };
    const events = [];
    const navigations = [];
    const frame = {
        isConnected: true,
        contentWindow: {
            document: {
                title: "",
                querySelector: () => null,
            },
            location: {
                get href() {
                    return href;
                },
                reload() {
                    if (options.navigation_fails) {
                        throw new Error("cross origin");
                    }
                    navigations.push(href);
                },
                replace(next_url) {
                    if (options.navigation_fails) {
                        throw new Error("cross origin");
                    }
                    navigations.push(next_url);
                    href = next_url;
                },
            },
            history: {
                state: route_state,
                replaceState(state, unused, next_url) {
                    this.state = state;
                    href = next_url;
                },
            },
            PopStateEvent: function(type, init) {
                this.type = type;
                this.state = init.state;
            },
            dispatchEvent(event) {
                events.push(event);
            },
        },
        set_url(next_url, next_state) {
            href = next_url;
            if (next_state !== undefined) {
                frame.contentWindow.history.state = next_state;
            }
        },
        events,
        navigations,
    };
    return frame;
}

test("back waits for the target URL and does not re-record a transient media route", () => {
    const { history, tick } = loadHistory();
    const frame = createFrame("https://x.com/home");
    history.track(frame);

    frame.set_url("https://x.com/user/status/10");
    tick();
    frame.set_url("https://x.com/user/status/10/photo/1");
    tick();
    assert.equal(history.can_back(frame), true);

    assert.equal(history.is_media_route(frame), true);
    // The native X back returns from the media route; that route must not be
    // inserted into the custom stack.
    frame.set_url("https://x.com/user/status/10");
    tick();
    assert.equal(history.can_back(frame), true);
    assert.equal(history.back(frame), true);
    assert.equal(history.can_back(frame), false);

    // X may briefly restore the media route while processing the synthetic popstate.
    frame.set_url("https://x.com/user/status/10/photo/1");
    tick();
    frame.set_url("https://x.com/home");
    tick();
    tick();

    // The transient media URL must not be re-added as a second entry.
    assert.equal(history.can_back(frame), false);
    assert.equal(frame.events.length, 1);
    assert.deepEqual(frame.events[0].state, { route: "current" });
});

test("back restores the history state recorded for the target URL", () => {
    const { history, tick } = loadHistory();
    const frame = createFrame("https://x.com/user/status/10");
    frame.contentWindow.history.state = { key: "parent" };
    history.track(frame);

    // A reply detail opened from the parent post carries its own router state.
    frame.set_url("https://x.com/other/status/20", { key: "reply" });
    tick();

    assert.equal(history.back(frame), true);
    // Passing the reply state would make the X router treat it as the same
    // entry and skip the re-render, so the parent state must be restored.
    assert.deepEqual(frame.contentWindow.history.state, { key: "parent" });
    assert.equal(frame.contentWindow.location.href, "https://x.com/user/status/10");
    assert.equal(frame.events.length, 1);
    assert.deepEqual(frame.events[0].state, { key: "parent" });
});

test("a second back is ignored while the first back is settling", () => {
    const { history, tick } = loadHistory();
    const frame = createFrame("https://x.com/home");
    history.track(frame);
    frame.set_url("https://x.com/explore");
    tick();

    assert.equal(history.back(frame), true);
    assert.equal(history.back(frame), false);
});

test("media routes are delegated to the native X back behavior", () => {
    const { history } = loadHistory();
    const frame = createFrame("https://x.com/user/status/10/photo/1");
    history.track(frame);

    assert.equal(history.is_media_route(frame), true);
    frame.set_url("https://x.com/user/status/10");
    assert.equal(history.is_media_route(frame), false);
});

test("a back that X ignores falls back to loading the target URL", () => {
    const { history, tick, advance } = loadHistory();
    const frame = createFrame("https://x.com/home");
    frame.contentWindow.history.state = { key: "home" };
    frame.contentWindow.document.title = "ホーム";
    history.track(frame);

    frame.set_url("https://x.com/user/status/10", { key: "post" });
    frame.contentWindow.document.title = "ポスト";
    tick();

    assert.equal(history.back(frame), true);
    // X does not re-render, so the view still shows the post while the URL says home.
    tick();
    assert.deepEqual(frame.navigations, []);
    advance(1000);
    tick();

    // The synthetic popstate got nowhere, so the target URL must actually be loaded.
    assert.deepEqual(frame.navigations, ["https://x.com/home"]);
    assert.equal(frame.contentWindow.location.href, "https://x.com/home");

    // A real navigation is authoritative: the rendered view can look identical
    // (same title) and the back must still be confirmed instead of rolling back.
    tick();
    tick();
    assert.equal(frame.navigations.length, 1);
    assert.equal(frame.contentWindow.location.href, "https://x.com/home");
    assert.equal(history.can_back(frame), false);
});

test("a back keeps the URL and the stack when the fallback cannot navigate", () => {
    const { history, tick, advance } = loadHistory();
    const frame = createFrame("https://x.com/home", { navigation_fails: true });
    frame.contentWindow.history.state = { key: "home" };
    frame.contentWindow.document.title = "ホーム";
    history.track(frame);

    frame.set_url("https://x.com/user/status/10", { key: "post" });
    frame.contentWindow.document.title = "ポスト";
    tick();

    assert.equal(history.back(frame), true);
    advance(3000);
    tick();

    // The URL must go back to what is actually rendered, and the stack must survive
    // so that the next Backspace retries instead of skipping an entry.
    assert.deepEqual(frame.navigations, []);
    assert.equal(frame.contentWindow.location.href, "https://x.com/user/status/10");
    assert.deepEqual(frame.contentWindow.history.state, { key: "post" });
    assert.equal(history.can_back(frame), true);
});

test("a column whose document stays unreadable does not stay blocked", () => {
    const { history, tick, advance } = loadHistory();
    const frame = createFrame("https://x.com/home");
    history.track(frame);
    frame.set_url("https://x.com/user/status/10");
    tick();

    assert.equal(history.back(frame), true);
    assert.equal(history.can_back(frame), false);

    // The fallback navigation leaves the column loading, so the URL is unreadable.
    // The wait must be released, or Backspace stays dead for this column.
    frame.set_url("about:blank");
    tick();
    assert.equal(history.can_back(frame), false);
    advance(15000);
    tick();
    assert.equal(history.can_back(frame), true);
});

test("a back that lands somewhere else reconnects the stack instead of dropping it", () => {
    const { history, tick, advance } = loadHistory();
    const frame = createFrame("https://x.com/home");
    history.track(frame);
    frame.set_url("https://x.com/explore");
    tick();
    frame.set_url("https://x.com/notifications");
    tick();

    assert.equal(history.back(frame), true);
    // X routes the column to an unrelated URL while the back is settling.
    frame.set_url("https://x.com/messages");
    tick();
    advance(3000);
    tick();

    assert.equal(history.can_back(frame), true);
});

test("a back is confirmed once the rendered view changes", () => {
    const { history, tick } = loadHistory();
    const frame = createFrame("https://x.com/home");
    frame.contentWindow.document.title = "ホーム";
    history.track(frame);
    frame.set_url("https://x.com/user/status/10");
    frame.contentWindow.document.title = "ポスト";
    tick();

    assert.equal(history.back(frame), true);
    frame.contentWindow.document.title = "ホーム";
    tick();
    tick();

    assert.equal(history.can_back(frame), false);
    assert.equal(frame.contentWindow.location.href, "https://x.com/home");
});
