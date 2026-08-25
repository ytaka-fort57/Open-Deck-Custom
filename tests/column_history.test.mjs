import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadHistory() {
    let timer_callback = null;
    const context = {
        URL,
        console: { warn: () => {} },
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
    };
}

function createFrame(initial_url) {
    let href = initial_url;
    const route_state = { route: "current" };
    const events = [];
    const frame = {
        isConnected: true,
        contentWindow: {
            location: {
                get href() {
                    return href;
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
