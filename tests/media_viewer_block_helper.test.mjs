import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadClickListener(){
    let click_listener = null;
    const context = {
        document: {
            addEventListener: (type, listener) => {
                if(type === "click"){
                    click_listener = listener;
                }
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/media_viewer_block_helper.js", "utf8"), context);
    return click_listener;
}

function eventFor(path){
    let stopped = false;
    return {
        altKey: false,
        target: {
            closest: (selector) => selector === 'img, div[data-testid="videoComponent"]'
                ? { getAttribute: () => "videoComponent" }
                : null,
        },
        composedPath: () => path,
        preventDefault: () => { stopped = true; },
        stopPropagation: () => { stopped = true; },
        stopImmediatePropagation: () => { stopped = true; },
        wasStopped: () => stopped,
    };
}

test("video playback clicks are left to X instead of opening the media viewer", () => {
    const click_listener = loadClickListener();
    const video_event = eventFor([{ tagName: "VIDEO" }]);
    click_listener(video_event);
    assert.equal(video_event.wasStopped(), false);

    const pause_event = eventFor([{ getAttribute: (name) => name === "aria-label" ? "一時停止" : null }]);
    click_listener(pause_event);
    assert.equal(pause_event.wasStopped(), false);
});
