//カラムごとの戻る
//ブラウザーの戻るはフレームをまたいだjoint session historyを対象とするため、
//どのカラムに対して history.back() を呼んでも「最後に遷移したカラム」が戻ってしまう。
//フレームを指定して戻る手段が無いので、カラムごとのURL履歴を独自に持つ。
window.opd_custom_column_history = (function(){
    const WATCH_INTERVAL_MS = 400;
    const HISTORY_LIMIT = 50;
    const BACK_SETTLE_TIMEOUT_MS = 3000;
    const BACK_FALLBACK_MS = 800;
    const BACK_ABANDON_TIMEOUT_MS = 15000;
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

    //Xのルーターはpopstateで history.state のkeyを見て描画するエントリを決める。
    //URLと一緒にその時点のstateも控えておき、戻る際に元のエントリのstateへ復元する。
    function current_state(iframe){
        try{
            return iframe.contentWindow.history.state ?? null;
        }catch(error){
            return null;
        }
    }

    //Xが実際に描画し直したかを見分ける手掛かり。
    //URLは戻る処理で自分が書き換えるため、成否の判定には使えない。
    function render_signal(iframe){
        try{
            const doc = iframe.contentWindow.document;
            const primary = doc.querySelector('[data-testid="primaryColumn"]');
            const article = primary?.querySelector('article a[href*="/status/"]');
            return [
                doc.title,
                primary?.getAttribute("aria-label") ?? "",
                article?.getAttribute("href") ?? ""
            ].join("|");
        }catch(error){
            return null;
        }
    }

    //描画が変わったか。手掛かりを読めない場合は判定できないため、進めた扱いにする
    function has_rendered(iframe, pending){
        const signal = render_signal(iframe);
        if(signal == null || pending.signal_before == null){
            return true;
        }
        return signal !== pending.signal_before;
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
            state.stack.push({url: first_url, route_state: current_state(iframe)});
        }
        const timer = setInterval(function(){
            if(!iframe.isConnected){
                clearInterval(timer);
                stacks.delete(iframe);
                return;
            }
            const url = current_url(iframe);
            if(url == null){
                //実ナビゲーションでの戻る中は一時的に参照できなくなる。
                //読み込みが戻ってこない場合に戻る操作を封じたままにしないため、
                //十分に待っても参照できないときは待ちを解く
                if(state.pending_back != null
                    && Date.now() - state.pending_back.started_at >= BACK_ABANDON_TIMEOUT_MS){
                    state.pending_back = null;
                }
                return;
            }

            // Xのpopstate処理は非同期。戻る処理中の中間URLを履歴へ戻すと、
            // メディアURLなどを何度も戻るループが発生するため、完了まで記録しない。
            if(state.pending_back != null){
                const pending = state.pending_back;
                const elapsed = Date.now() - pending.started_at;
                const timed_out = elapsed >= BACK_SETTLE_TIMEOUT_MS;
                //実ナビゲーションで戻した場合、描画はそのURLの読み込み結果そのものなので
                //手掛かりの比較は要らない
                if(url === pending.target_url && (pending.navigated || has_rendered(iframe, pending))){
                    pending.confirmations += 1;
                    if(pending.confirmations >= BACK_CONFIRMATION_COUNT){
                        const target_index = last_index_of_url(state.stack, pending.target_url);
                        state.stack = target_index >= 0
                            ? state.stack.slice(0, target_index + 1)
                            : [{url: pending.target_url, route_state: pending.route_state}];
                        state.pending_back = null;
                    }
                }else if(url === pending.target_url){
                    // URLは目的地だが描画が変わっていない。擬似popstateでは戻せない
                    // ケースなので、戻り先URLを実際に読み込ませて確実に戻す。
                    pending.confirmations = 0;
                    if(!pending.navigated && elapsed >= BACK_FALLBACK_MS){
                        pending.navigated = navigate_to_target(iframe, pending);
                    }
                    // 文書を参照できない場合は実ナビゲーションもできない。履歴を削ると
                    // 次の戻るが1つ飛ばしになるため、URLだけ元へ戻して retry させる。
                    if(!pending.navigated && timed_out){
                        rollback(iframe, pending);
                        state.pending_back = null;
                    }
                }else{
                    // Xが別のURLへ動いた場合は、その結果へ履歴を合わせる。
                    // 履歴を捨てると以降そのカラムで戻れなくなるため、繋ぎ直すだけにする。
                    pending.confirmations = 0;
                    if(timed_out){
                        resync(state, url, current_state(iframe));
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

            const top = state.stack[state.stack.length - 1];
            if(top != null && top.url === url){
                //同じ画面のままXがstateを差し替える場合があるため、控えを更新する
                top.route_state = current_state(iframe);
                return;
            }
            state.stack.push({url: url, route_state: current_state(iframe)});
            if(state.stack.length > HISTORY_LIMIT){
                state.stack.shift();
            }
        }, WATCH_INTERVAL_MS);
    }

    function last_index_of_url(stack, url){
        for(let index = stack.length - 1; index >= 0; index--){
            if(stack[index].url === url){
                return index;
            }
        }
        return -1;
    }

    //擬似popstateをXが無視した場合の最終手段。戻り先URLを実際に読み込ませる。
    //back()でURLは既に戻り先へ書き換えてあるため、通常はreloadで足りる。
    //location.assign()は使わない。joint session historyへエントリが積まれ、
    //そのカラムが「直近に遷移したフレーム」になってX標準の戻るを狂わせる。
    //reload / replace はどちらも現在のエントリを置き換えるため、その心配がない。
    //再読み込みを伴うためスクロール位置は失われるが、戻れないより良い。
    function navigate_to_target(iframe, pending){
        try{
            const column_window = iframe.contentWindow;
            if(column_window.location.href !== pending.target_url){
                column_window.location.replace(pending.target_url);
            }else{
                column_window.location.reload();
            }
            return true;
        }catch(error){
            //参照できない場合は諦める
            return false;
        }
    }

    //戻れなかった場合にURLだけ元へ戻す。描画は動いていないためpopstateは流さない
    function rollback(iframe, pending){
        if(pending.origin_url == null){
            return;
        }
        try{
            iframe.contentWindow.history.replaceState(pending.origin_state, "", pending.origin_url);
        }catch(error){
            //参照できない場合は諦める
        }
    }

    //現在URLへ履歴を繋ぎ直す。既に持っているURLならそこまで、無ければ末尾へ足す
    function resync(state, url, route_state){
        const index = last_index_of_url(state.stack, url);
        if(index >= 0){
            state.stack = state.stack.slice(0, index + 1);
            return;
        }
        state.stack.push({url: url, route_state: route_state});
        if(state.stack.length > HISTORY_LIMIT){
            state.stack.shift();
        }
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
        const target = state.stack[state.stack.length - 2];
        const target_url = target.url;
        //今いる画面のstateを渡すと、Xのルーターが同じエントリと判断して再描画しない。
        //戻る先を記録した時点のstateへ戻す。控えが無い場合はnullで新しいエントリ扱いにする。
        const target_state = target.route_state ?? null;
        const column_window = iframe.contentWindow;
        const origin_url = current_url(iframe);
        const origin_state = current_state(iframe);
        const signal_before = render_signal(iframe);
        let replaced = false;
        try{
            column_window.history.replaceState(target_state, "", target_url);
            replaced = true;
            state.pending_back = {
                target_url,
                route_state: target_state,
                origin_url: origin_url,
                origin_state: origin_state,
                signal_before: signal_before,
                started_at: Date.now(),
                confirmations: 0,
                navigated: false,
            };
            column_window.dispatchEvent(new column_window.PopStateEvent("popstate", {state: target_state}));
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
