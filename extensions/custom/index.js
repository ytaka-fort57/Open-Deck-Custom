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
    const KEYS_ATTR = "opd_custom_keys_attached";
    const selectors = window.opd_custom_selectors;
    const column_state = window.opd_custom_column_state;
    const keyboard = window.opd_custom_keyboard;
    const column_history = window.opd_custom_column_history;
    const column_reorder = window.opd_custom_column_reorder;
    const lifecycle = window.opd_custom_lifecycle;
    const list_repost_filter = window.opd_custom_list_repost_filter;

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

    //Xのページが読み込まれ、仕掛ける価値のある文書になっているか
    function is_loaded(iframe){
        const doc = iframe.contentDocument;
        if(doc == null || doc.readyState != "complete"){
            return false;
        }
        return doc.location != null && doc.location.href.indexOf("http") == 0;
    }

    //タイムラインカラムを左からの並び順で取得する
    function get_timeline_columns(){
        return Array.from(document.querySelectorAll('#opd_main_element div[opd_column_type="home"]'));
    }

    //このカラムが今どこにあるか。並び替えで動くため、保存のたびに求め直す
    function current_column_index(iframe){
        return get_timeline_columns().findIndex(function(column){
            return column.querySelector("iframe") === iframe;
        });
    }

    //ユーザーがタブを切り替えたら、そのカラムの選択として覚える
    //desired はこのカラムが表示すべきタブ。ユーザー操作が常に優先される
    function watch_tab_click(doc, profile_index, iframe, desired){
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
            const column_index = current_column_index(iframe);
            if(column_index < 0){
                return;
            }
            column_state.save_tab(profile_index, column_index, label);
        }, true);
    }

    //保存したタブを選び直す。
    //ピン留めしたリストのタブは別URLへのリンクで、押すとそのカラムが遷移する。
    //自動の遷移はjoint session historyへエントリを積み、ユーザーが操作している
    //別カラムの戻るを奪うため、復元のための遷移は1カラムにつき1回までとする。
    function restore_tab(doc, desired, target){
        if(selectors.navigates(doc, target)){
            if(desired.navigated){
                return false;
            }
            desired.navigated = true;
        }
        selectors.click_tab(target);
        return true;
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
            restore_tab(doc, desired, target);
        }, INTERVAL_MS);
    }

    function apply_saved_tab(doc, desired){
        if(desired.label == undefined){
            return;
        }
        selectors.wait_for_tabs(doc, 15000, function(){
            const target = selectors.find_tab_by_label(doc, desired.label);
            if(target != null && !selectors.is_selected(target)){
                restore_tab(doc, desired, target);
            }
            enforce_tab(doc, desired);
        });
    }

    function setup_column(iframe, profile_index){
        //iframeは同一オリジンのため親から直接操作できる
        const doc = iframe.contentDocument;
        if(doc == null){
            return;
        }
        const column_index = current_column_index(iframe);
        if(column_index < 0){
            return;
        }
        column_state.get_tab(profile_index, column_index, function(saved_label){
            const desired = {label: saved_label};
            watch_tab_click(doc, profile_index, iframe, desired);
            apply_saved_tab(doc, desired);
        });
    }

    function setup_timeline_columns(){
        const columns = get_timeline_columns();
        if(columns.length == 0){
            return;
        }
        column_state.get_profile_index(function(profile_index){
            columns.forEach(function(column){
                const iframe = column.querySelector("iframe");
                if(iframe == null || iframe.getAttribute(APPLIED_ATTR) != null){
                    return;
                }
                iframe.setAttribute(APPLIED_ATTR, "true");
                //自動更新などで再読み込みされた場合も選択し直す
                iframe.addEventListener("load", function(){
                    setup_column(iframe, profile_index);
                });
                //生成直後のiframeは about:blank で readyState は complete になる。
                //その文書はXの読み込みで捨てられるため、仕掛けても無駄に終わる
                if(is_loaded(iframe)){
                    setup_column(iframe, profile_index);
                }
            });
        });
    }

    //キー操作はフォーカスがどのカラムにあっても効かせる必要があるため、
    //タイムライン以外も含めたすべてのカラムの文書に仕掛ける
    function setup_column_keys(){
        keyboard.attach(document, document, null);
        const iframes = document.querySelectorAll("#opd_main_element div[opd_column_type] iframe");
        iframes.forEach(function(iframe){
            //ラックをまたぐカラム移動でiframeが一度切断されると追跡が止まる。
            //trackは追跡中なら何もしないため、毎回呼んで再開できるようにする
            column_history.track(iframe);
            if(iframe.getAttribute(KEYS_ATTR) != null){
                return;
            }
            iframe.setAttribute(KEYS_ATTR, "true");
            //読み込みのたびに文書が入れ替わるため、その都度仕掛け直す
            iframe.addEventListener("load", function(){
                keyboard.attach(iframe.contentDocument, document, iframe);
            });
            keyboard.attach(iframe.contentDocument, document, iframe);
        });
    }

    function setup_list_repost_filter(){
        if(list_repost_filter != null){
            list_repost_filter.setup(document, lifecycle);
        }
    }

    //サイドバーとカラムは本家の初期化完了後に生成されるため、生成を監視して処理する
    const observer = new MutationObserver(function(){
        add_menu_button();
        setup_timeline_columns();
        setup_column_keys();
        setup_list_repost_filter();
        column_reorder.setup(document);
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    add_menu_button();
    setup_timeline_columns();
    setup_column_keys();
    setup_list_repost_filter();
})();
