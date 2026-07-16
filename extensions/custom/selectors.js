//X側のDOMを探す処理をまとめる
//Xのclass名は自動生成で変わるため、role属性と表示ラベルだけを手掛かりにする
window.opd_custom_selectors = (function(){

    //タイムライン選択タブの一覧を返す
    function get_tabs(doc){
        const tab_list = doc.querySelector('[role="tablist"]');
        if(tab_list == null){
            return [];
        }
        let tabs = Array.from(tab_list.querySelectorAll('[role="tab"]'));
        if(tabs.length == 0){
            //role属性が変わった場合の保険としてリンク要素で代替する
            tabs = Array.from(tab_list.querySelectorAll('a'));
        }
        return tabs;
    }

    function tab_label(tab){
        return (tab.textContent || "").trim();
    }

    function is_selected(tab){
        return tab.getAttribute("aria-selected") === "true";
    }

    function find_tab_by_label(doc, label){
        return get_tabs(doc).find(function(tab){
            return tab_label(tab) === label;
        });
    }

    //タブはSPAの描画後に現れるため、出現を待ってから処理する
    function wait_for_tabs(doc, timeout_ms, callback){
        const interval_ms = 200;
        let waited_ms = 0;
        const timer = setInterval(function(){
            const tabs = get_tabs(doc);
            if(tabs.length > 0){
                clearInterval(timer);
                callback(tabs);
                return;
            }
            waited_ms += interval_ms;
            if(waited_ms >= timeout_ms){
                clearInterval(timer);
            }
        }, interval_ms);
    }

    return {
        get_tabs: get_tabs,
        tab_label: tab_label,
        is_selected: is_selected,
        find_tab_by_label: find_tab_by_label,
        wait_for_tabs: wait_for_tabs
    };
})();
