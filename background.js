const EXTENSION_DOMAIN = new URL(chrome.runtime.getURL('')).hostname;
//Xの長文ポストの上限(25,000文字)
const TEXT_REVIEW_MAX_LENGTH = 25000;

//インストール時にあらかじめDNRを設定しておく
chrome.runtime.onInstalled.addListener(() => {
    (async () => {
        await update_dnr();
    })();
})

chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse){
        if(sender?.id !== chrome.runtime.id || request == null || typeof request !== "object"){
            sendResponse(false);
            return false;
        }
        if(request.message === "dnr_upd"){
            (async () => {
                try {
                    //デッキ本体のページから来たときだけ、そのタブをカラム用ルールの対象にする
                    const is_deck_tab = sender.tab != null && sender.frameId === 0 && is_deck_url(sender.url);
                    await update_dnr(is_deck_tab ? sender.tab.id : undefined);
                    console.log("dnr_update_ok");
                    sendResponse(true);
                } catch(e) {
                    console.error("dnr update failed->", e);
                    sendResponse(false);
                }
            })();
            return true;
        }
        if(request.message === "text_review"){
            //外部サービスへ送る値は、ポスト本文として取り得る文字列だけにする
            if(typeof request.review_text !== "string" || request.review_text.length === 0 || request.review_text.length > TEXT_REVIEW_MAX_LENGTH){
                sendResponse(false);
                return false;
            }
            const api_url = "https://opd.kwdev-sys.com/api/opd/text_review/review";
            (async () => {
                const controller = new AbortController();
                const timeout_id = setTimeout(() => controller.abort(), 15000);
                try{
                    const res = await fetch(api_url, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({"text":request.review_text}),
                        signal: controller.signal,
                    });

                    if(!res.ok){
                        console.error(`ReviewFetchError->Code:${res.status}->Text:${res.statusText}`);
                        sendResponse(false);
                        return;
                    }
                    sendResponse(await res.json());
                }catch(error){
                    console.error("Fetch failed:", error);
                    sendResponse(false);
                }finally{
                    clearTimeout(timeout_id);
                }
            })();
            return true;
        }
        if(request.message === "ext_reload"){
            chrome.runtime.reload();
            return false;
        }
        sendResponse(false);
        return false;
    }
)
//
let access_limit = {
    search:{limit: null, remaining: null, reset_unix_time: null}, 
    time_line:{limit: null, remaining: null, reset_unix_time: null}, 
    recommend_timeline:{limit: null, remaining: null, reset_unix_time: null}
};
function send_content_script(value){
    //chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });//firefoxではsession.setAccessLevel()が未対応なのでsessionは一旦お預け
    //chrome.storage.session.set
    chrome.storage.local.set({api_access_limit: value}, function(){
        console.log("set ok");
      });
    /*chrome.storage.local.set({api_access_limit: value}).then(() => {
        console.log("set ok");
      });*/
}

chrome.webRequest.onHeadersReceived.addListener(function (resp) {
    let category = null;
    if(resp.url.includes("SearchTimeline")){
        category = "search";
    }else if(resp.url.includes("HomeLatestTimeline")){
        category = "time_line";
    }else if(resp.url.includes("HomeTimeline")){
        category = "recommend_timeline";
    }

    if (!category) return;

    for(const header of resp.responseHeaders){
        switch (header.name) {
            case "x-rate-limit-remaining":
                access_limit[category].remaining = header.value;
                break;
            case "x-rate-limit-limit":
                access_limit[category].limit = header.value;
                break;
            case "x-rate-limit-reset":
                access_limit[category].reset_unix_time = header.value;
                break;
        }
    }

    send_content_script(access_limit);
}, { urls: [
    '*://x.com/i/api/graphql/*/SearchTimeline*',
    '*://x.com/i/api/graphql/*/HomeLatestTimeline*',
    '*://x.com/i/api/graphql/*/HomeTimeline*',
    '*://twitter.com/i/api/graphql/*/SearchTimeline*',
    '*://twitter.com/i/api/graphql/*/HomeLatestTimeline*',
    '*://twitter.com/i/api/graphql/*/HomeTimeline*'
] }, ['responseHeaders']);


const DNR_REMOVE_FRAME_HEADERS = {
    type: "modifyHeaders",
    responseHeaders: [
        {
            header: "Content-Security-Policy",
            operation: "remove"
        },
        {
            header: "X-Frame-Options",
            operation: "remove"
        }
    ]
};

//デッキ本体のURL(extensions/custom/deck_url.js と同じく、サブドメイン・末尾スラッシュ1つ・クエリを許す)
const DECK_URL_REGEX = "^https://([^/?#]+\\.)?(x|twitter)\\.com/run-opdeck/?(\\?.*)?$";
const DNR_DECK_PAGE_RULE_ID = 2;
const DNR_DECK_FRAME_RULE_ID = 10;
const DNR_DECK_WORKER_RULE_ID = 11;
//タブに属さない要求(サービスワーカーの fetch など)の tabId
const TAB_ID_NONE = chrome.tabs?.TAB_ID_NONE ?? -1;

function is_deck_url(url){
    return typeof url === "string" && new RegExp(DECK_URL_REGEX, "i").test(url);
}

//CSPを外すのはデッキ本体のページと、デッキを開いているタブのカラムだけにする。
//x.com では X のサービスワーカー(sw.js)がカラムの iframe 遷移を中継するため、
//ネットワーク上の要求は sub_frame ではなく tabId のない xmlhttprequest / other になる。
//タブでは絞れないので、この要求を対象にするルールはデッキのタブが開いている間だけ置く。
//(その間はサービスワーカーを通る通常閲覧のページでもCSPが外れうる。BL-058)
function update_dnr(deck_tab_id){
    return run_dnr_task(async () => {
        await chrome.declarativeNetRequest.updateDynamicRules({
            //1 は以前の版が置いていた、タブを問わないカラム用ルール
            removeRuleIds: [1, DNR_DECK_PAGE_RULE_ID],
            addRules: [{
                id : DNR_DECK_PAGE_RULE_ID,
                priority: 1,
                action: DNR_REMOVE_FRAME_HEADERS,
                condition : {
                    regexFilter: DECK_URL_REGEX,
                    resourceTypes: ["main_frame", "xmlhttprequest", "other"]
                }
            }],
        });
        const tab_ids = new Set(await get_deck_tab_ids());
        if(Number.isInteger(deck_tab_id) && deck_tab_id >= 0){
            tab_ids.add(deck_tab_id);
        }
        await set_deck_tab_ids([...tab_ids]);
    });
}

function release_deck_tab(tab_id){
    return run_dnr_task(async () => {
        const tab_ids = await get_deck_tab_ids();
        if(tab_ids.includes(tab_id)){
            await set_deck_tab_ids(tab_ids.filter((id) => id !== tab_id));
        }
    });
}

//デッキのタブの一覧はセッションルール自体に持たせ、サービスワーカーが止まっても失わないようにする
async function get_deck_tab_ids(){
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const rule = rules.find((rule) => rule.id === DNR_DECK_FRAME_RULE_ID);
    return rule?.condition?.tabIds ?? [];
}

function set_deck_tab_ids(tab_ids){
    const add_rules = tab_ids.length === 0 ? [] : [
        {
            id : DNR_DECK_FRAME_RULE_ID,
            priority: 1,
            action: DNR_REMOVE_FRAME_HEADERS,
            condition : {
                requestDomains: ["x.com", "twitter.com"],
                initiatorDomains: [EXTENSION_DOMAIN, "x.com", "twitter.com"],
                resourceTypes: ["sub_frame"],
                tabIds: tab_ids
            }
        },
        {
            id : DNR_DECK_WORKER_RULE_ID,
            priority: 1,
            action: DNR_REMOVE_FRAME_HEADERS,
            condition : {
                requestDomains: ["x.com", "twitter.com"],
                initiatorDomains: ["x.com", "twitter.com"],
                resourceTypes: ["xmlhttprequest", "other"],
                tabIds: [TAB_ID_NONE]
            }
        },
    ];
    return chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [DNR_DECK_FRAME_RULE_ID, DNR_DECK_WORKER_RULE_ID],
        addRules: add_rules,
    });
}

//読んでから書き戻すため、ルールの更新は1つずつ順に行う
let dnr_task_queue = Promise.resolve();
function run_dnr_task(task){
    const result = dnr_task_queue.then(task);
    dnr_task_queue = result.catch(() => {});
    return result;
}

chrome.tabs?.onRemoved?.addListener((tab_id) => {
    release_deck_tab(tab_id).catch((e) => console.error("dnr release failed->", e));
});
//デッキ以外へ移動したタブを外す。URLが読めないページ(他サイト)もデッキではない
chrome.tabs?.onUpdated?.addListener((tab_id, change_info, tab) => {
    if(change_info.status === "loading" && !is_deck_url(change_info.url ?? tab?.url)){
        release_deck_tab(tab_id).catch((e) => console.error("dnr release failed->", e));
    }
});