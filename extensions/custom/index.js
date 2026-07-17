//カスタム版独自機能の入口
//本家ファイルへの変更を増やさないため、UIへの追加やカラム制御はここからDOM操作で行う
(function(){
    //本家と同じく、デッキ本体のURLでのみ動かす
    //このスクリプトは各カラムのiframe(通常のx.comページ)にも読み込まれるため必須
    if(location.href != "https://x.com/run-opdeck" && location.href != "https://twitter.com/run-opdeck"){
        return;
    }

    const CUSTOM_MENU_ID = "opd_custom_settings_import";
    const APPLIED_ATTR = "opd_custom_tab_applied";
    const selectors = window.opd_custom_selectors;
    const column_state = window.opd_custom_column_state;

    function open_settings_import(){
        window.open(chrome.runtime.getURL("extensions/custom/settings_import.html"), "OPD-Custom-Settings-Import", 'width=760, height=680');
    }

    function add_menu_button(){
        const profile_loader_btn = document.getElementById("profile_load_save");
        if(profile_loader_btn == null || document.getElementById(CUSTOM_MENU_ID) != null){
            return;
        }
        const import_btn = document.createElement("input");
        import_btn.type = "button";
        import_btn.id = CUSTOM_MENU_ID;
        import_btn.value = "設定インポート";
        import_btn.title = "本家Open-Deckから書き出した設定を取り込みます";
        import_btn.addEventListener("click", open_settings_import);
        profile_loader_btn.insertAdjacentElement("afterend", import_btn);
        profile_loader_btn.insertAdjacentHTML("afterend", "<br>");
    }

    //タイムラインカラムを左からの並び順で取得する
    function get_timeline_columns(){
        return Array.from(document.querySelectorAll('#opd_main_element div[opd_column_type="home"]'));
    }

    //ユーザーがタブを切り替えたら、そのカラムの選択として覚える
    //desired はこのカラムが表示すべきタブ。ユーザー操作が常に優先される
    function watch_tab_click(doc, profile_index, column_index, desired){
        doc.addEventListener("click", function(event){
            const target = event.target;
            if(target == null || target.closest == undefined){
                return;
            }
            const tab = target.closest('[role="tab"]');
            if(tab == null){
                return;
            }
            const label = selectors.tab_label(tab);
            desired.label = label;
            column_state.save_tab(profile_index, column_index, label);
        }, true);
    }

    //Xはタブ選択をアカウント単位で共有し、読み込み後もしばらく自前の状態を適用し続ける。
    //一度選び直すだけではX側に上書きされて戻るため、しばらく監視して選び直し続ける。
    //desired.label はユーザーのクリックで更新されるため、ユーザー操作と競合しない。
    function enforce_tab(doc, desired){
        const ENFORCE_MS = 20000;
        const INTERVAL_MS = 1000;
        let elapsed_ms = 0;
        const timer = setInterval(function(){
            elapsed_ms += INTERVAL_MS;
            if(elapsed_ms >= ENFORCE_MS || doc.defaultView == null){
                clearInterval(timer);
                return;
            }
            if(desired.label == undefined){
                return;
            }
            const target = selectors.find_tab_by_label(doc, desired.label);
            //タブ自体が無くなった場合(リスト削除など)は諦める
            if(target == null || selectors.is_selected(target)){
                return;
            }
            selectors.click_tab(target);
        }, INTERVAL_MS);
    }

    function apply_saved_tab(doc, desired){
        if(desired.label == undefined){
            return;
        }
        selectors.wait_for_tabs(doc, 15000, function(){
            const target = selectors.find_tab_by_label(doc, desired.label);
            if(target != null && !selectors.is_selected(target)){
                selectors.click_tab(target);
            }
            enforce_tab(doc, desired);
        });
    }

    function setup_column(iframe, profile_index, column_index){
        //iframeは同一オリジンのため親から直接操作できる
        const doc = iframe.contentDocument;
        if(doc == null){
            return;
        }
        column_state.get_tab(profile_index, column_index, function(saved_label){
            const desired = {label: saved_label};
            watch_tab_click(doc, profile_index, column_index, desired);
            apply_saved_tab(doc, desired);
        });
    }

    function setup_timeline_columns(){
        const columns = get_timeline_columns();
        if(columns.length == 0){
            return;
        }
        column_state.get_profile_index(function(profile_index){
            columns.forEach(function(column, column_index){
                const iframe = column.querySelector("iframe");
                if(iframe == null || iframe.getAttribute(APPLIED_ATTR) != null){
                    return;
                }
                iframe.setAttribute(APPLIED_ATTR, "true");
                //自動更新などで再読み込みされた場合も選択し直す
                iframe.addEventListener("load", function(){
                    setup_column(iframe, profile_index, column_index);
                });
                if(iframe.contentDocument != null && iframe.contentDocument.readyState == "complete"){
                    setup_column(iframe, profile_index, column_index);
                }
            });
        });
    }

    //サイドバーとカラムは本家の初期化完了後に生成されるため、生成を監視して処理する
    const observer = new MutationObserver(function(){
        add_menu_button();
        setup_timeline_columns();
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    add_menu_button();
    setup_timeline_columns();
})();
