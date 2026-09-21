//カラム内の戻る操作を、入力・メディア・履歴状態に応じて分類する。
window.opd_custom_navigation_policy = (function(){
    function classify_back(options){
        const source = options?.source;
        if(options?.is_media_route === true){
            return "native";
        }
        if(source === "keyboard" && options?.key === "Backspace"){
            return options?.is_typing === true ? "ignore" : "column";
        }
        if(source === "app-bar" && options?.key === "Back"){
            return options?.can_back === true ? "column" : "consume";
        }
        return "ignore";
    }

    return {
        classify_back: classify_back,
    };
})();
