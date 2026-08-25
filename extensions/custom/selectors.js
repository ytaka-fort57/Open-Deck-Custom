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

    //Xの実処理はrole="tab"より内側の要素に付いている場合があるため、
    //最も内側のラベル要素を押してイベントを外へ伝播させる
    function click_tab(tab){
        const label_node = tab.querySelector("span");
        if(label_node != null){
            label_node.click();
        }else{
            tab.click();
        }
    }

    //そのタブが別URLへのリンクか。ピン留めしたリストのタブが該当する
    function tab_path(tab){
        const anchor = tab.tagName === "A" ? tab : (tab.querySelector("a") ?? tab.closest("a"));
        const href = anchor?.getAttribute("href");
        if(href == null || href === ""){
            return null;
        }
        try{
            return new URL(href, anchor.baseURI).pathname;
        }catch(error){
            return null;
        }
    }

    //押すとページ遷移が起きるタブかどうか。
    //遷移を伴うタブを自動で押すとjoint session historyへエントリが積まれ、
    //ユーザーが操作している別カラムの戻るを奪ってしまう
    function navigates(doc, tab){
        const path = tab_path(tab);
        return path != null && path !== doc.location.pathname;
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
        click_tab: click_tab,
        tab_path: tab_path,
        navigates: navigates,
        find_tab_by_label: find_tab_by_label,
        wait_for_tabs: wait_for_tabs
    };
})();
