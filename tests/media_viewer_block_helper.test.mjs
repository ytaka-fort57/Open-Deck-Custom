import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadHelper(){
    let click_listener = null;
    let init_listener = null;
    const dispatched = [];
    const parent_document = {
        dispatchEvent: (event) => dispatched.push(JSON.parse(event.detail)),
    };
    const context = {
        document: {
            addEventListener: (type, listener) => {
                if(type === "click"){
                    click_listener = listener;
                }else if(type === "opd_send_media_info_init"){
                    init_listener = listener;
                }
            },
        },
        window: { parent: { document: parent_document } },
        CustomEvent: class {
            constructor(type, init = {}){
                this.type = type;
                Object.assign(this, init);
            }
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/media_viewer_block_helper.js", "utf8"), context);
    return { click_listener, init_listener, dispatched };
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

function react_props(props){
    return Object.assign({}, { "__reactProps$fixture": props });
}

function quotedMediaEvent({ compact = false } = {}){
    const quoted_media = [
        { media_url_https: "https://x.com/quoted-first.jpg" },
        { media_url_https: "https://x.com/quoted-current.jpg" },
    ];
    const direct_media = [
        { media_url_https: "https://x.com/direct.jpg" },
    ];
    const quoted_children = compact
        ? [{ props: { attachment: { props: { children: { props: { mediaDetails: quoted_media } } } } } }]
        : [
            [
                {
                    props: {
                        children: [
                            null,
                            {
                                props: {
                                    children: [
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        { props: { children: { props: { mediaDetails: quoted_media } } } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
            { props: { children: [{ props: { mediaDetails: direct_media } }] } },
            { props: { tweet: { extended_entities: { media: direct_media } } } },
        ];
    const quoted_props = react_props({
        children: quoted_children,
    });
    const image = {
        src: "https://x.com/quoted-current",
        getAttribute: () => null,
        querySelector: () => null,
        closest: (selector) => {
            if(selector === 'div[tabindex="0"][role="link"]') return quoted_props;
            if(selector === 'img, div[data-testid="videoComponent"]') return image;
            if(selector === 'div[aria-labelledby][id]') return quoted_props;
            return null;
        },
    };
    return {
        altKey: false,
        target: image,
        composedPath: () => [image],
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        quoted_media,
    };
}

function directMediaEvent({ altKey = false, legacy = false, matching = true } = {}){
    const media = [
        { media_url_https: "https://x.com/direct-first.jpg" },
        { media_url_https: "https://x.com/direct-current.jpg" },
    ];
    const root_props = react_props({
        children: [
            null,
            legacy ? null : { props: { children: [{ props: { mediaDetails: media } }] } },
            legacy ? { props: { tweet: { extended_entities: { media } } } } : null,
        ],
    });
    let stopped = false;
    let link_clicked = false;
    const link = { click: () => { link_clicked = true; } };
    const cell = {};
    const image = {
        src: matching ? "https://x.com/direct-current?format=jpg" : "https://x.com/not-in-media.jpg",
        getAttribute: () => null,
        querySelector: () => null,
        closest: (selector) => {
            if(selector === 'div[tabindex="0"][role="link"]') return null;
            if(selector === 'img, div[data-testid="videoComponent"]') return image;
            if(selector === 'div[aria-labelledby][id]') return root_props;
            if(selector === 'div[data-testid="cellInnerDiv"]') return cell;
            if(selector === 'a[href]') return link;
            return null;
        },
    };
    return {
        altKey,
        target: image,
        composedPath: () => [image],
        preventDefault: () => { stopped = true; },
        stopPropagation: () => { stopped = true; },
        stopImmediatePropagation: () => { stopped = true; },
        wasStopped: () => stopped,
        wasLinkClicked: () => link_clicked,
        media,
    };
}

test("video playback clicks are left to X instead of opening the media viewer", () => {
    const { click_listener } = loadHelper();
    const video_event = eventFor([{ tagName: "VIDEO" }]);
    click_listener(video_event);
    assert.equal(video_event.wasStopped(), false);

    const pause_event = eventFor([{ getAttribute: (name) => name === "aria-label" ? "一時停止" : null }]);
    click_listener(pause_event);
    assert.equal(pause_event.wasStopped(), false);
});

test("quoted media details take precedence over the outer post media", () => {
    const { click_listener, dispatched } = loadHelper();
    const event = quotedMediaEvent();

    click_listener(event);

    assert.equal(dispatched.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0].media_info)), event.quoted_media);
    assert.equal(dispatched[0].selected_index, 1);
});

test("quoted media is found when a compact column changes the React children layout", () => {
    const { click_listener, dispatched } = loadHelper();
    const event = quotedMediaEvent({ compact: true });

    click_listener(event);

    assert.equal(dispatched.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0].media_info)), event.quoted_media);
    assert.equal(dispatched[0].selected_index, 1);
});

test("direct post media and the initialized token are sent with the selected index", () => {
    const { click_listener, init_listener, dispatched } = loadHelper();
    const event = directMediaEvent();

    init_listener({ detail: JSON.stringify({ token: "viewer-token" }) });
    click_listener(event);

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].token, "viewer-token");
    assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0].media_info)), event.media);
    assert.equal(dispatched[0].selected_index, 1);
});

test("direct post media falls back to extended_entities and index zero when the URL does not match", () => {
    const { click_listener, dispatched } = loadHelper();
    const event = directMediaEvent({ legacy: true, matching: false });

    click_listener(event);

    assert.equal(dispatched.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0].media_info)), event.media);
    assert.equal(dispatched[0].selected_index, 0);
});

test("Alt-click leaves media viewer dispatch disabled and follows the media link", () => {
    const { click_listener, dispatched } = loadHelper();
    const event = directMediaEvent({ altKey: true });

    click_listener(event);

    assert.equal(dispatched.length, 0);
    assert.equal(event.wasStopped(), true);
    assert.equal(event.wasLinkClicked(), true);
});
