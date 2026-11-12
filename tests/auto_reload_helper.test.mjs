import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function fiberChain(tail, hops){
    let fiber = tail;
    for(let i = 0; i < hops; i++){
        fiber = { return: fiber, memoizedProps: {} };
    }
    return fiber;
}

function loadHelper({ region = null, item = null } = {}){
    let reload_listener = null;
    const context = {
        console,
        document: {
            addEventListener(){},
            querySelector(selector){
                if(selector === 'section[role="region"]'){
                    return region;
                }
                if(selector === "li[data-index]"){
                    return item;
                }
                return null;
            },
        },
        window: {
            addEventListener(type, listener){
                if(type === "opd_column_reload"){
                    reload_listener = listener;
                }
            },
        },
        HTMLElement: class HTMLElement {},
        MutationObserver: class {
            observe(){}
        },
        location: { pathname: "/home", search: "" },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/auto_reload_helper.js", "utf8"), context);
    return {
        reload(){
            reload_listener({ detail: JSON.stringify({ token: null }) });
        },
    };
}

test("the legacy For You region path still refreshes the timeline", () => {
    const calls = [];
    const region = {
        __reactProps$fixture: {
            children: [
                null,
                { props: { children: [null, null, { _owner: { memoizedProps: { onRefresh(){ calls.push("legacy"); } } } }] } },
            ],
        },
    };
    loadHelper({ region }).reload();
    assert.deepEqual(calls, ["legacy"]);
});

test("a shifted onRefresh on an ancestor fiber is used when the fixed child path is gone", () => {
    const calls = [];
    const region = {
        __reactProps$fixture: { children: [] },
        __reactFiber$fixture: fiberChain({
            memoizedProps: { onRefresh(){ calls.push("ancestor"); } },
        }, 3),
    };
    loadHelper({ region }).reload();
    assert.deepEqual(calls, ["ancestor"]);
});

test("the x-web list uses fetchTop on an ancestor handle instead of refreshOrGoTop", () => {
    const calls = [];
    const item = {
        __reactFiber$fixture: fiberChain({
            ref: {
                current: {
                    fetchTop(){ calls.push("fetchTop"); },
                    refreshOrGoTop(){ calls.push("refreshOrGoTop"); },
                },
            },
        }, 6),
    };
    loadHelper({ item }).reload();
    assert.deepEqual(calls, ["fetchTop"]);
});

test("pull-to-refresh onRefresh is preferred over a farther fetchTop handle", () => {
    const calls = [];
    const item = {
        __reactFiber$fixture: fiberChain({
            memoizedProps: { onRefresh(){ calls.push("pull"); } },
            return: {
                ref: { current: { fetchTop(){ calls.push("fetchTop"); } } },
            },
        }, 2),
    };
    loadHelper({ item }).reload();
    assert.deepEqual(calls, ["pull"]);
});

test("refreshOrGoTop is used when the handle has no fetchTop", () => {
    const calls = [];
    const item = {
        __reactFiber$fixture: {
            ref: { current: { refreshOrGoTop(){ calls.push("refreshOrGoTop"); } } },
        },
    };
    loadHelper({ item }).reload();
    assert.deepEqual(calls, ["refreshOrGoTop"]);
});

test("a refresh handle 39 fibers up is still used", () => {
    const calls = [];
    const item = {
        __reactFiber$fixture: fiberChain({
            ref: { current: { fetchTop(){ calls.push("fetchTop"); } } },
        }, 39),
    };
    loadHelper({ item }).reload();
    assert.deepEqual(calls, ["fetchTop"]);
});

test("a refresh handle past the 40-fiber limit is not called", () => {
    const calls = [];
    const item = {
        __reactFiber$fixture: fiberChain({
            ref: { current: { fetchTop(){ calls.push("fetchTop"); } } },
        }, 40),
    };
    loadHelper({ item }).reload();
    assert.deepEqual(calls, []);
});

test("a missing timeline does not throw and does not call a refresh", () => {
    assert.doesNotThrow(() => loadHelper().reload());
});
