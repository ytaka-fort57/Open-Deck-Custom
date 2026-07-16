//カスタム版独自機能の入口
//本家ファイルへの変更を増やさないため、UIへの追加はここからDOM操作で行う
(function(){
    const CUSTOM_MENU_ID = "opd_custom_settings_import";

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

    //サイドバーは本家の初期化完了後に生成されるため、生成を監視して追加する
    const observer = new MutationObserver(function(){
        add_menu_button();
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    add_menu_button();
})();
