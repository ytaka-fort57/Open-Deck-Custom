//カスタム版独自機能の入口
//本家ファイルへの変更を増やさないため、UIへの追加やカラム制御はここからDOM操作で行う
(function(){
    //本家と同じく、デッキ本体のURLでのみ動かす
    //このスクリプトは各カラムのiframe(通常のx.comページ)にも読み込まれるため必須
    if(!window.opd_custom_deck_url.is_deck_url(location.href)){
        return;
    }

    const CUSTOM_MENU_ID = "opd_custom_settings_import";
    const APPLIED_ATTR = "opd_custom_tab_applied";
    const KEYS_ATTR = "opd_custom_keys_attached";
    const NAVIGATED_ATTR = "opd_custom_tab_navigated";
    const selectors = window.opd_custom_selectors;
    const column_state = window.opd_custom_column_state;
    const keyboard = window.opd_custom_keyboard;
    const navigation_policy = window.opd_custom_navigation_policy;
    const column_history = window.opd_custom_column_history;
    const column_reorder = window.opd_custom_column_reorder;
    const column_dom = window.opd_custom_column_dom;
    const lifecycle = window.opd_custom_lifecycle;
    const list_repost_filter = window.opd_custom_list_repost_filter;
    const short_post_filter = window.opd_custom_short_post_filter;

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
        import_btn.value = chrome.i18n.getMessage("ui_custom_settings_import_button");
        import_btn.title = chrome.i18n.getMessage("ui_custom_settings_import_title");
        import_btn.addEventListener("click", open_settings_import);
        profile_loader_btn.insertAdjacentElement("afterend", import_btn);
        profile_loader_btn.insertAdjacentHTML("afterend", "<br>");
    }

    //タイムラインカラムを左からの並び順で取得する
    //
    //独自の並び替えはDOMを動かさずflexのorderだけを変えるため、DOM順は表示順と一致しない。
    //タブ保存の鍵・並び替え時の付け替え・プロファイル保存はすべて表示順が基準で、
    //ここだけDOM順で数えると、並び替え後に別カラムの保存を奪う。
    function get_timeline_columns(){
        const ordered = column_reorder?.get_visual_column_elements?.(document);
        const columns = ordered ?? Array.from(document.querySelectorAll("#opd_main_element div[opd_column_type]"));
        return columns.filter(function(column){
            return column.getAttribute?.("opd_column_type") === "home";
        });
    }

    //このカラムのタブ保存の鍵。
    //移行後はカラム固有の安定IDなので並び替えでも変わらない。移行前(位置キー)の起動では
    //表示位置を返すため、並び替えのたびに求め直す必要がある
    function current_column_key(iframe){
        const columns = get_timeline_columns();
        const index = columns.findIndex(function(column){
            return column.querySelector("iframe") === iframe;
        });
        if(index < 0){
            return null;
        }
        return column_state.column_key(columns[index], index);
    }

    //ユーザーがタブを切り替えたら、そのカラムの選択として覚える
    //desired はこのカラムが表示すべきタブ。ユーザー操作が常に優先される
    function watch_tab_click(doc, iframe, desired){
        doc.addEventListener("click", function(event){
            const target = event.target;
            if(target == null || target.closest == undefined){
                return;
            }
            const tab = target.closest('[role="tab"]');
            //ホームカラムから遷移した先のページのタブは、タイムラインの選択ではない
            if(tab == null || !selectors.is_timeline_tab_page(doc)){
                return;
            }
            const label = selectors.tab_label(tab);
            desired.label = label;
            const column_key = current_column_key(iframe);
            if(column_key == null){
                return;
            }
            column_state.get_profile_index(function(profile_index){
                column_state.save_tab(profile_index, column_key, label);
            });
        }, true);
    }

    //保存したタブを選び直す。
    //ピン留めしたリストのタブは別URLへのリンクで、押すとそのカラムが遷移する。
    //クリックはjoint session historyへエントリを積み、ユーザーが操作している
    //別カラムの戻るを奪うため、遷移は location.replace で行い、回数は
    //iframe属性で load をまたいで1カラム1回までとする。
    function has_restored_navigation(iframe, desired){
        return desired.navigated || iframe.getAttribute(NAVIGATED_ATTR) != null;
    }

    function mark_restored_navigation(iframe, desired){
        desired.navigated = true;
        iframe.setAttribute(NAVIGATED_ATTR, "true");
    }

    function restore_tab(doc, desired, target, iframe){
        if(selectors.navigates(doc, target)){
            if(has_restored_navigation(iframe, desired)){
                return false;
            }
            mark_restored_navigation(iframe, desired);
            if(selectors.restore_without_history(doc, target)){
                return true;
            }
            //href が取れない場合だけクリックする。1回制限済み。
            selectors.click_tab(target);
            return true;
        }
        selectors.click_tab(target);
        return true;
    }

    //Xはタブ選択をアカウント単位で共有し、読み込み後もしばらく自前の状態を適用し続ける。
    //一度選び直すだけではX側に上書きされて戻るため、しばらく監視して選び直し続ける。
    //desired.label はユーザーのクリックで更新されるため、ユーザー操作と競合しない。
    function enforce_tab(doc, desired, iframe){
        const ENFORCE_MS = 20000;
        const INTERVAL_MS = 1000;
        let elapsed_ms = 0;
        const timer = setInterval(function(){
            elapsed_ms += INTERVAL_MS;
            if(elapsed_ms >= ENFORCE_MS || doc.defaultView == null){
                clearInterval(timer);
                return;
            }
            //別ページへ移った間は、同名のタブ(/followers の「フォロー中」など)を押さない
            if(desired.label == undefined || !selectors.is_timeline_tab_page(doc)){
                return;
            }
            const target = selectors.find_tab_by_label(doc, desired.label);
            //タブ自体が無くなった場合(リスト削除など)は諦める
            if(target == null || selectors.is_selected(target)){
                return;
            }
            restore_tab(doc, desired, target, iframe);
        }, INTERVAL_MS);
    }

    function apply_saved_tab(doc, desired, iframe){
        if(desired.label == undefined){
            return;
        }
        selectors.wait_for_tabs(doc, 15000, function(){
            const target = selectors.is_timeline_tab_page(doc) ? selectors.find_tab_by_label(doc, desired.label) : null;
            if(target != null && !selectors.is_selected(target)){
                restore_tab(doc, desired, target, iframe);
            }
            enforce_tab(doc, desired, iframe);
        });
    }

    //プロファイル番号は読み込みのたびに取り直す。表示中より前のプロファイルを削除すると
    //番号が詰まるが、デッキは作り直されないため、仕掛けた時点の番号を持ち続けるとずれる
    function setup_column(iframe){
        //iframeは同一オリジンのため親から直接操作できる
        const doc = iframe.contentDocument;
        if(doc == null){
            return;
        }
        const column_key = current_column_key(iframe);
        if(column_key == null){
            return;
        }
        column_state.get_profile_index(function(profile_index){
            column_state.get_tab(profile_index, column_key, function(saved_label){
                const desired = {label: saved_label};
                watch_tab_click(doc, iframe, desired);
                apply_saved_tab(doc, desired, iframe);
            });
        });
    }

    function setup_timeline_columns(){
        const columns = get_timeline_columns();
        if(columns.length == 0){
            return;
        }
        //鍵が安定IDか表示位置かが決まる前に仕掛けると、移行後の起動でも位置キーで保存してしまう
        column_state.when_ready(function(){
            attach_timeline_columns(columns);
        });
    }

    function attach_timeline_columns(columns){
        columns.forEach(function(column){
            const iframe = column.querySelector("iframe");
            if(iframe == null || iframe.getAttribute(APPLIED_ATTR) != null){
                return;
            }
            iframe.setAttribute(APPLIED_ATTR, "true");
            //自動更新などで再読み込みされた場合も選択し直す
            iframe.addEventListener("load", function(){
                setup_column(iframe);
            });
            //生成直後のiframeは about:blank で readyState は complete になる。
            //その文書はXの読み込みで捨てられるため、仕掛けても無駄に終わる
            if(column_dom.is_frame_loaded(iframe)){
                setup_column(iframe);
            }
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
                attach_column_back(iframe.contentDocument, iframe);
            });
            keyboard.attach(iframe.contentDocument, document, iframe);
            attach_column_back(iframe.contentDocument, iframe);
        });
    }

    // X標準の戻るボタンは joint session history を使うため、
    // メディア以外では対象カラムの独自履歴へ置き換える。
    // 独自履歴が無くても history.back() には落とさない。
    // 落とすと直近に遷移した別カラムが戻ってしまう。
    function attach_column_back(doc, iframe){
        if(doc == null){
            return;
        }
        const on_click = function(event){
            const back_button = event.target?.closest?.('button[data-testid="app-bar-back"]');
            if(back_button == null){
                return;
            }
            const action = navigation_policy.classify_back({
                source: "app-bar",
                key: "Back",
                is_media_route: column_history.is_media_route?.(iframe),
                can_back: column_history.can_back(iframe),
            });
            if(action === "ignore" || action === "native") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if(action === "column"){
                column_history.back(iframe);
            }
        };
        doc.addEventListener("click", on_click, true);
        lifecycle.register_column_resource(iframe, "column-back-button", function(){
            doc.removeEventListener("click", on_click, true);
        });
    }

    function setup_list_repost_filter(){
        if(list_repost_filter != null){
            list_repost_filter.setup(document, lifecycle);
        }
    }

    function setup_short_post_filter(){
        if(short_post_filter != null){
            short_post_filter.setup(document, lifecycle);
        }
    }

    function setup_all(){
        add_menu_button();
        setup_timeline_columns();
        setup_column_keys();
        setup_list_repost_filter();
        setup_short_post_filter();
        column_reorder.setup(document);
    }

    //本家とXの描画は短時間に大量のMutationを発生させる。どの処理も冪等な全体走査
    //なので、同一バースト内の呼び出しを1回へまとめる。MutationObserver自体は
    //マイクロタスク単位でしかまとめないため、タスクをまたぐ連続描画には効かない。
    //requestAnimationFrameは背面タブで止まりカラム追加を取りこぼすため使わない。
    const SETUP_DEBOUNCE_MS = 50;
    let setup_timer = null;
    function schedule_setup(){
        if(setup_timer != null){
            return;
        }
        setup_timer = setTimeout(function(){
            setup_timer = null;
            setup_all();
        }, SETUP_DEBOUNCE_MS);
    }

    //デッキは起動時に読んだプロファイル一覧をメモリに持ち、変更のたびに全体を書き戻す。
    //開いたまま設定がインポートされたら、その内容を上書きする前に読み込み直す
    chrome.storage.onChanged.addListener(function(changes, area_name){
        if(window.opd_custom_storage.is_import_change(changes, area_name)){
            location.reload();
        }
    });

    //サイドバーとカラムは本家の初期化完了後に生成されるため、生成を監視して処理する
    const observer = new MutationObserver(schedule_setup);
    observer.observe(document.documentElement, {childList: true, subtree: true});
    add_menu_button();
    setup_timeline_columns();
    setup_column_keys();
    setup_list_repost_filter();
    setup_short_post_filter();
})();
