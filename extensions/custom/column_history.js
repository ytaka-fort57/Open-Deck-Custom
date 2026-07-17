//カラムごとの戻る
//ブラウザーの戻るはフレームをまたいだjoint session historyを対象とするため、
//どのカラムに対して history.back() を呼んでも「最後に遷移したカラム」が戻ってしまう。
//フレームを指定して戻る手段が無いので、カラムごとのURL履歴を独自に持つ。
window.opd_custom_column_history = (function(){
    const WATCH_INTERVAL_MS = 400;
    const HISTORY_LIMIT = 50;
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
        const stack = [];
        stacks.set(iframe, stack);
        const first_url = current_url(iframe);
        if(first_url != null){
            stack.push(first_url);
        }
        const timer = setInterval(function(){
            if(!iframe.isConnected){
                clearInterval(timer);
                stacks.delete(iframe);
                return;
            }
            const url = current_url(iframe);
            if(url == null || stack[stack.length - 1] === url){
                return;
            }
            stack.push(url);
            if(stack.length > HISTORY_LIMIT){
                stack.shift();
            }
        }, WATCH_INTERVAL_MS);
    }

    function can_back(iframe){
        const stack = stacks.get(iframe);
        return stack != null && stack.length >= 2;
    }

    //そのカラムだけを前のURLへ戻す
    //replaceStateでURLを差し替えたうえでpopstateを流し、Xのルーターに再描画させる。
    //リロードを伴わないためスクロール位置が残る。
    function back(iframe){
        if(!can_back(iframe)){
            return false;
        }
        const stack = stacks.get(iframe);
        const target_url = stack[stack.length - 2];
        const column_window = iframe.contentWindow;
        try{
            column_window.history.replaceState(null, "", target_url);
            column_window.dispatchEvent(new column_window.PopStateEvent("popstate", {state: null}));
        }catch(error){
            //移動できなかった場合に履歴を削ると、次の戻るが1つ飛ばしになる
            return false;
        }
        stack.pop();
        return true;
    }

    return {
        track: track,
        can_back: can_back,
        back: back
    };
})();
