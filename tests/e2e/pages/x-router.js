//fixture用の最小ルーター
//Xの再現ではなく、カラムごとの戻るとタブ復元がE2Eで観測できる分だけを持つ。
//独自履歴は「URLの変化」と「描画の変化」で成否を判定するため、
//pushState / popstate に対して title と aria-label を必ず動かす。
(function(){
    const primary = document.querySelector('[data-testid="primaryColumn"] > div[tabindex="0"]');
    const root_label = primary?.getAttribute("aria-label") ?? document.title;
    const root_path = location.pathname;
    const root_title = document.title;

    function render(){
        const path = location.pathname;
        const is_root = path === root_path;
        document.title = is_root ? root_title : path;
        primary?.setAttribute("aria-label", is_root ? root_label : path);
        const link = document.getElementById("opd_fixture_post_link");
        if(link != null){
            link.setAttribute("href", is_root ? root_path : path);
        }
    }

    //XのSPA遷移に相当する。テストから呼び出す
    window.opdFixtureNavigate = function(path){
        history.pushState({opd_fixture_key: path}, "", path);
        render();
    };

    window.addEventListener("popstate", render);

    //選択タブはX側が持つため、fixtureでも押された側へ移す
    document.addEventListener("click", function(event){
        const tab = event.target?.closest?.('[role="tab"]');
        if(tab == null){
            return;
        }
        document.querySelectorAll('[role="tab"]').forEach(function(item){
            item.setAttribute("aria-selected", String(item === tab));
        });
    });

    render();
})();
