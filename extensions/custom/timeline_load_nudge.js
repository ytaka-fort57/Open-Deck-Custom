//フィルタで投稿を隠してタイムラインが伸びなかったとき、Xの追加読み込みを促す
window.opd_custom_timeline_load_nudge = (function(){
    //Xが隠したセルの高さを測り直して並べ直すまで待ってから判定する
    const NUDGE_DELAY_MS = 200;
    const pending_timers = new WeakMap();
    const pending_frames = new WeakMap();
    //一度促した非表示対象で繰り返し促さない。新しく隠した投稿があるときだけ動く
    const seen_targets = new WeakSet();

    function is_near_bottom(doc){
        const win = doc?.defaultView;
        const root = doc?.scrollingElement ?? doc?.documentElement;
        if(win == null || root == null){
            return false;
        }
        const viewport = win.innerHeight;
        if(!(viewport > 0)){
            return false;
        }
        //残りのスクロール量が1画面分以下なら、利用者のスクロールだけでは読み込みが起きにくい
        return root.scrollHeight - (win.scrollY + viewport) <= viewport;
    }

    function schedule_restore(doc, win, restore){
        let settled = false;
        function finish(){
            if(settled){
                return;
            }
            settled = true;
            pending_frames.delete(doc);
            restore();
        }
        if(typeof win.requestAnimationFrame !== "function"){
            finish();
            return;
        }
        const frame_id = win.requestAnimationFrame(finish);
        pending_frames.set(doc, { win, frame_id, finish });
    }

    //表示が1画面に満たないと scrollBy が効かない。1フレームだけ伸ばしてスクロールを発生させる
    function nudge_collapsed(doc, win){
        const body = doc.body;
        const root = doc.scrollingElement ?? doc.documentElement;
        if(body == null || root == null || typeof doc.createElement !== "function"){
            return false;
        }
        const spacer = doc.createElement("div");
        spacer.setAttribute("data-opd-timeline-load-nudge", "");
        spacer.setAttribute("aria-hidden", "true");
        const height = Math.max(2, win.innerHeight - root.scrollHeight + 2);
        spacer.style.height = height + "px";
        spacer.style.pointerEvents = "none";
        body.appendChild(spacer);
        win.scrollBy(0, 1);
        schedule_restore(doc, win, function(){
            win.scrollBy(0, -1);
            spacer.remove();
        });
        return true;
    }

    function nudge(doc){
        const win = doc?.defaultView;
        const root = doc?.scrollingElement ?? doc?.documentElement;
        if(win == null || root == null || typeof win.scrollBy !== "function" || !is_near_bottom(doc)){
            return false;
        }
        //Xは次ページの読み込みを、信頼済みのスクロール(位置の変化)で始める。
        //dispatchEvent の scroll は isTrusted が false で、末尾の交差監視も動かない。
        if(root.scrollHeight - win.innerHeight > 0){
            const delta = win.scrollY > 0 ? -1 : 1;
            win.scrollBy(0, delta);
            schedule_restore(doc, win, function(){
                win.scrollBy(0, -delta);
            });
            return true;
        }
        return nudge_collapsed(doc, win);
    }

    function request(doc, hidden_targets){
        if(doc == null || hidden_targets == null){
            return false;
        }
        let has_new_target = false;
        for(const target of hidden_targets){
            if(!seen_targets.has(target)){
                seen_targets.add(target);
                has_new_target = true;
            }
        }
        if(!has_new_target || pending_timers.has(doc)){
            return has_new_target;
        }
        pending_timers.set(doc, setTimeout(function(){
            pending_timers.delete(doc);
            nudge(doc);
        }, NUDGE_DELAY_MS));
        return true;
    }

    function cancel(doc){
        const timer = doc == null ? null : pending_timers.get(doc);
        if(timer != null){
            clearTimeout(timer);
            pending_timers.delete(doc);
        }
        const pending = doc == null ? null : pending_frames.get(doc);
        if(pending != null){
            pending.win.cancelAnimationFrame?.(pending.frame_id);
            pending.finish();
        }
    }

    return {
        NUDGE_DELAY_MS,
        cancel,
        is_near_bottom,
        nudge,
        request,
    };
})();
