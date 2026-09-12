//カラム追加・削除・load監視のDOM境界をまとめる
window.opd_custom_column_dom = (function(){
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

    function dispose_and_remove(column, lifecycle){
        if(column == null){
            return false;
        }
        lifecycle?.dispose_column_resources_in?.(column);
        column.remove();
        return true;
    }

    function watch_load_column(column_frames, max_retries = 5, schedule = setTimeout){
        const cleanups = [];
        const cleanup = function(){
            cleanups.splice(0).forEach(function(dispose){
                dispose();
            });
        };

        Array.from(column_frames ?? []).forEach(function(column){
            const onLoad = function(){
                try{
                    column.contentWindow.document.querySelector("head");
                }catch(error){
                    //遷移途中のloadでもsrcを再代入せず、送信後の画面を保持する
                }
            };

            column.addEventListener("load", onLoad);
            cleanups.push(function(){
                column.removeEventListener("load", onLoad);
            });
        });

        schedule(cleanup, max_retries * 500 + 1000);
        return cleanup;
    }

    return {
        dispose_and_remove,
        get_add_target,
        insert_before_target,
        watch_load_column,
    };
})();
