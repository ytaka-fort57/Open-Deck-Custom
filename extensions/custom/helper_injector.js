//iframe(カラム)へ helper スクリプトを差し込む手順を1か所に集める。
//本家の OpdUtils / OpdExtAutoReload / OpdMediaViewerBlocker / OpdTextReview が
//それぞれ書いていた「script生成 → getURL → head追加 → load後に token を CustomEvent で渡す」を統一する。
window.opd_custom_helper_injector = (function(){
    //init_event_name を渡すと token を発行して load 後に送り、その token を返す。
    //送り先は helper 側の document/window どちらの capture リスナーにも届くよう、
    //カラムの document 上で bubbles/composed 付きの CustomEvent として発火する。
    function inject(column_window, helper_path, init_event_name){
        const column_document = column_window.document;
        const helper_script = column_document.createElement("script");
        helper_script.src = chrome.runtime.getURL(helper_path);

        let token = null;
        if(init_event_name){
            token = crypto.randomUUID();
            helper_script.addEventListener("load", function(){
                column_document.dispatchEvent(new CustomEvent(init_event_name, {
                    bubbles: true,
                    composed: true,
                    detail: JSON.stringify({token: token}),
                }));
            });
        }

        //load リスナーを付けてから追加する(追加してから付けると取りこぼす)
        column_document.head.appendChild(helper_script);
        return token;
    }

    return {
        inject,
    };
})();
