//カラムごとの戻る
//ブラウザーの戻るはフレームをまたいだjoint session historyを対象とするため、
//どのカラムに対して history.back() を呼んでも「最後に遷移したカラム」が戻ってしまう。
//フレームを指定して戻る手段が無いので、カラムごとのURL履歴を独自に持つ。
window.opd_custom_column_history = (function(){
    const WATCH_INTERVAL_MS = 400;
    const HISTORY_LIMIT = 50;
    const BACK_SETTLE_TIMEOUT_MS = 3000;
    const BACK_CONFIRMATION_COUNT = 2;
    const MEDIA_ROUTE_RE = /(?:^|\/)status\/[^/]+\/(?:photo|video)\/\d+\/?$/i;
    const stacks = new WeakMap();

    //カラムのURL。記録する価値のないものはnullを返す
    function current_url(iframe){
        let url = null;
        try{
            url = iframe.contentWindow.location.href;
        }catch(error){
            //読み込み中などで参照できない場合
            return null;
        }
        //生成直後のiframeは about:blank。これを履歴に混ぜると、
        //そのカラムで最初にBackspaceを押したときに空白ページへ戻ってしまう
        if(url == null || url.indexOf("http") != 0){
            return null;
        }
        return url;
    }

    //XはSPAのため遷移してもiframeのloadは起きない。URLの変化を監視して記録する
    function track(iframe){
        if(stacks.has(iframe)){
            return;
        }
        const state = {
            stack: [],
            pending_back: null,
        };
        stacks.set(iframe, state);
        const first_url = current_url(iframe);
        if(first_url != null && !is_media_route_url(first_url)){
            state.stack.push(first_url);
        }
        const timer = setInterval(function(){
            if(!iframe.isConnected){
                clearInterval(timer);
                stacks.delete(iframe);
                return;
            }
            const url = current_url(iframe);
            if(url == null){
                return;
            }

            // Xのpopstate処理は非同期。戻る処理中の中間URLを履歴へ戻すと、
            // メディアURLなどを何度も戻るループが発生するため、完了まで記録しない。
            if(state.pending_back != null){
                const pending = state.pending_back;
                if(url === pending.target_url){
                    pending.confirmations += 1;
                    if(pending.confirmations >= BACK_CONFIRMATION_COUNT){
                        const target_index = state.stack.lastIndexOf(pending.target_url);
                        state.stack = target_index >= 0
                            ? state.stack.slice(0, target_index + 1)
                            : [pending.target_url];
                        state.pending_back = null;
                    }
                }else{
                    pending.confirmations = 0;
                    if(Date.now() - pending.started_at >= BACK_SETTLE_TIMEOUT_MS){
                        // 目的地へ到達できなかった場合は、壊れたスタックを捨てて
                        // 現在URLだけを基準にする。
                        state.stack = [url];
                        state.pending_back = null;
                    }
                }
                return;
            }

            // メディアURLはX標準のjoint historyで処理する。独自スタックへ
            // 混ぜると、標準の戻る後に同じメディアURLへ再び戻ってしまう。
            if(is_media_route_url(url)){
                return;
            }

            if(state.stack[state.stack.length - 1] === url){
                return;
            }
            state.stack.push(url);
            if(state.stack.length > HISTORY_LIMIT){
                state.stack.shift();
            }
        }, WATCH_INTERVAL_MS);
    }

    function can_back(iframe){
        const state = stacks.get(iframe);
        return state != null && state.pending_back == null && state.stack.length >= 2;
    }

    function is_media_route_url(url){
        try{
            return MEDIA_ROUTE_RE.test(new URL(url).pathname);
        }catch(error){
            return false;
        }
    }

    function is_media_route(iframe){
        return is_media_route_url(current_url(iframe));
    }

    //そのカラムだけを前のURLへ戻す
    //replaceStateでURLを差し替えたうえでpopstateを流し、Xのルーターに再描画させる。
    //リロードを伴わないためスクロール位置が残る。
    function back(iframe){
        if(!can_back(iframe)){
            return false;
        }
        const state = stacks.get(iframe);
        const target_url = state.stack[state.stack.length - 2];
        const column_window = iframe.contentWindow;
        let replaced = false;
        try{
            const current_state = column_window.history.state;
            column_window.history.replaceState(current_state, "", target_url);
            replaced = true;
            state.pending_back = {
                target_url,
                started_at: Date.now(),
                confirmations: 0,
            };
            column_window.dispatchEvent(new column_window.PopStateEvent("popstate", {state: current_state}));
        }catch(error){
            if(!replaced){
                return false;
            }
        }
        return true;
    }

    return {
        track: track,
        can_back: can_back,
        is_media_route: is_media_route,
        back: back
    };
})();
