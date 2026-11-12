//自動更新機能用
(() => {
    let path_old = null;
    let opd_reload_token = null;
    let reload_func = ()=>{};
    let isFocusDisabled = false;
    
    //ユーザー操作でフォーカス無効化を解除する
    ['mousedown', 'keydown', 'touchstart'].forEach(type => {
        document.addEventListener(type, () => {
            isFocusDisabled = false;
        }, { capture: true, passive: true });
    });

    // 自動更新時にフォーカスされる問題があるので、scrollIntoViewとfocusを一時的に無効化する。
    // 標準動作へ委ねるとXの復元処理がタイムラインを先頭までスクロールさせるため、
    // スクロール親が見つからない場合は何もしない。
    HTMLElement.prototype.scrollIntoView = function(options) {
        //フォーカス無効化が有効だった場合はフォーカスを無視する
        if (isFocusDisabled) return;

        //カラム側のスクロールが親の横スクロールにも伝搬する問題を以下で対処する
        //直近のスクロール可能な親要素を探す
        let parent = this.parentElement;
        while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflow)) {
            parent = parent.parentElement;
        }
        if (!parent) return;

        //対象要素とスクロール親の位置差分を取得してスクロールする
        const client_rect = this.getBoundingClientRect();
        const parent_client_rect = parent.getBoundingClientRect();

        //はみ出し量を算出
        const delta = (start, end, pStart, pEnd) =>
            start < pStart ? start - pStart : end > pEnd ? end - pEnd : 0;

        parent.scrollBy({
            left: delta(client_rect.left, client_rect.right, parent_client_rect.left, parent_client_rect.right),
            top: delta(client_rect.top, client_rect.bottom, parent_client_rect.top, parent_client_rect.bottom),
            behavior: options?.behavior
        });
    };

    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(options) {
        if (isFocusDisabled){
            return;
        }
        //Xは戻る操作の復元で記事へfocusする。スクロールを伴わせない
        return originalFocus.call(this, Object.assign({}, options, { preventScroll: true }));
    };

    //現在描画されているタイムラインから更新関数を取得する。
    //Reactの再描画で以前の関数は無効になるため、更新のたびに取り直す。
    //旧クライアントは section[role="region"] の決まった子に onRefresh がある。
    //x-web ではその section が無く、投稿リストは li[data-index]。
    //更新関数は祖先 Fiber の onRefresh、または命令ハンドルの fetchTop / refreshOrGoTop。
    //fetchTop は先頭の取得で、refreshOrGoTop は先頭にいないとスクロールだけになる。
    const REFRESH_FIBER_HOP_LIMIT = 40;

    function legacy_region_refresh(section){
        const props = get_props(section, "Props");
        const refresh = props?.children?.[1]?.props?.children?.[2]?._owner?.memoizedProps?.onRefresh;
        return typeof refresh === 'function' ? refresh : null;
    }

    function refresh_from_handle(handle){
        if(handle == null || typeof handle !== "object"){
            return null;
        }
        if(typeof handle.fetchTop === "function"){
            return function(){
                handle.fetchTop();
            };
        }
        if(typeof handle.refreshOrGoTop === "function"){
            return handle.refreshOrGoTop;
        }
        return null;
    }

    function refresh_from_fiber(fiber){
        const from_props = fiber?.memoizedProps?.onRefresh;
        if(typeof from_props === "function"){
            return from_props;
        }
        return refresh_from_handle(fiber?.ref?.current)
            ?? refresh_from_handle(fiber?.stateNode);
    }

    function refresh_by_fiber(start){
        let fiber = get_props(start, "Fiber");
        let hop = 0;
        while(fiber && hop < REFRESH_FIBER_HOP_LIMIT){
            const refresh = refresh_from_fiber(fiber);
            if(typeof refresh === "function"){
                return refresh;
            }
            fiber = fiber.return;
            hop += 1;
        }
        return null;
    }

    function resolve_reload_func(){
        try{
            const region = document.querySelector('section[role="region"]');
            if(region){
                const legacy = legacy_region_refresh(region);
                if(legacy){
                    return legacy;
                }
                const from_region = refresh_by_fiber(region);
                if(from_region){
                    return from_region;
                }
            }
            const item = document.querySelector('li[data-index]');
            if(!item){
                return null;
            }
            return refresh_by_fiber(item);
        }catch(err){
            console.warn('resolve_reload_func threw->', err);
            return null;
        }
    }
    // URLで画面の遷移を監視する
    new MutationObserver(function(){
        const path_search = `${location.pathname}${location.search}`;
        if(path_old === path_search){
            return;
        }
        const refresh = resolve_reload_func();
        if (!refresh){
            // 関数が存在しない場合、無意味な関数を設定しておく
            reload_func = ()=>{};
            return;
        }
        reload_func = refresh;
        path_old = path_search;
    }).observe(document, {childList: true, subtree: true});
    //ReactProps取得関数
    function get_props(elem, type){
        const prop_type = type === "Props" ? type : "Fiber";
        const propsKey = Object.getOwnPropertyNames(elem).find(k => k.includes(`__react${prop_type}$`));
        return propsKey ? elem[propsKey] : null;
    }
    //機能動作用のトークンを設定
    window.addEventListener('opd_column_reload_init', (e)=>{
        try {
            const detail = JSON.parse(e.detail);
            opd_reload_token = detail.token;
        } catch (err) {
            console.warn('invalid init detail->', err);
        }
    }, true);
    //自動更新イベントを追加する
    window.addEventListener('opd_column_reload', (e) => {
        const detail = JSON.parse(e.detail);
        if(opd_reload_token && opd_reload_token !== detail.token) return;

        //描画中のタイムラインから取り直し、取れない場合のみ前回値を使う
        const refresh = resolve_reload_func() ?? reload_func;
        if(typeof refresh !== 'function') return;
        reload_func = refresh;

        try {
            isFocusDisabled = true;
            refresh();
        } catch (err) {
            console.warn('reload_func threw->', err);
        }
    }, true);
})();