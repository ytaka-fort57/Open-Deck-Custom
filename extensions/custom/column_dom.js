//カラム追加・削除・load監視のDOM境界をまとめる
window.opd_custom_column_dom = (function(){
    //Xのページが読み込まれ、仕掛ける価値のある文書になっているか
    //クロスオリジンのiframeでは contentDocument 参照自体が投げるため握り潰す
    function is_frame_loaded(iframe){
        try{
            const doc = iframe?.contentDocument;
            if(doc == null || doc.readyState !== "complete"){
                return false;
            }
            return doc.location != null && doc.location.href.startsWith("http");
        }catch(error){
            return false;
        }
    }

    function get_add_target(doc, is_shift_pressed){
        const empty_column = doc?.querySelector?.(".dsp_column_emptycolumn");
        const rack = empty_column?.parentElement;
        const first_column = Array.from(rack?.children ?? []).find(function(element){
            return element.tagName === "SECTION" && element.getAttribute("draggable") === "true";
        });
        return (is_shift_pressed && first_column) ? first_column : empty_column;
    }

    function insert_before_target(add_target_column, new_column_html, reorder_api){
        if(add_target_column == null){
            return null;
        }
        add_target_column.insertAdjacentHTML("beforebegin", new_column_html);
        const new_column = add_target_column.previousElementSibling;
        reorder_api?.move_before?.(new_column, add_target_column);
        return new_column;
    }

    function add_column(doc, type, template, settings_api, create_id, reorder_api, is_shift_pressed = false){
        const add_target_column = get_add_target(doc, is_shift_pressed);
        if(add_target_column == null){
            return null;
        }
        //安定IDは追加時に発行する。表示中のカラムのIDと重複させない
        const setting = Object.assign(settings_api.new_column_setting(type), {
            opd_custom_uid: settings_api.issue_uid(settings_api.collect_uids(doc), create_id),
        });
        const html = settings_api.render(template, setting, create_id());
        return insert_before_target(add_target_column, html, reorder_api);
    }

    function dispose_and_remove(column, lifecycle){
        if(column == null){
            return false;
        }
        lifecycle?.dispose_column_resources_in?.(column);
        column.remove();
        return true;
    }

    return {
        add_column,
        dispose_and_remove,
        get_add_target,
        insert_before_target,
        is_frame_loaded,
    };
})();
