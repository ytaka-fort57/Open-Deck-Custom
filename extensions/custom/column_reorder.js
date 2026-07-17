//カラムの並び替え
//本家はドラッグ＆ドロップでしか並び替えられず操作しづらいため、
//左右ボタンと表示順の選択をカラムバーに足す。
//
//並び順の保存(column_settings_save)は本家の内部関数で直接は呼べない。
//本家のdropハンドラーが「要素の移動」と「保存」を両方行うため、
//dropイベントを発火させて本家の経路にそのまま乗せる。
window.opd_custom_column_reorder = (function(){
    const CONTROL_CLASS = "opd_custom_reorder";

    //同じ段の中で並び替えできるカラム。末尾の空カラムなどは含まない
    function get_columns(section){
        const rack = section.parentElement;
        if(rack == null){
            return [];
        }
        return Array.from(rack.children).filter(function(element){
            return element.tagName === "SECTION" && element.getAttribute("draggable") === "true";
        });
    }

    function move_to(section, target_index){
        const columns = get_columns(section);
        const current_index = columns.indexOf(section);
        if(current_index < 0 || target_index === current_index){
            return false;
        }
        if(target_index < 0 || target_index >= columns.length){
            return false;
        }
        //本家のdropは「この要素の前に差し込む」ため、右へ動かす場合は
        //目的地の次の要素へ落とす。末尾へ動かす場合の落とし先は空カラムになる
        const drop_target = target_index < current_index
            ? columns[target_index]
            : columns[target_index].nextElementSibling;
        if(drop_target == null){
            return false;
        }
        const transfer = new DataTransfer();
        transfer.setData("text/plain", section.id);
        drop_target.dispatchEvent(new DragEvent("drop", {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true
        }));
        //移動でどのカラムの位置も変わる。監視任せにすると、続けて押したときに
        //古い状態のボタンが押せないままになる
        get_columns(section).forEach(refresh);
        return true;
    }

    function refresh(section){
        const wrap = section.querySelector("." + CONTROL_CLASS);
        if(wrap == null){
            return;
        }
        const columns = get_columns(section);
        const current_index = columns.indexOf(section);
        const select = wrap.querySelector("select");

        //操作中に作り替えると選択できなくなる
        if(select !== select.ownerDocument.activeElement && select.options.length !== columns.length){
            select.innerHTML = columns.map(function(column, index){
                return '<option value="' + index + '">' + (index + 1) + "</option>";
            }).join("");
        }
        select.value = String(current_index);
        wrap.querySelector(".opd_custom_move_left").disabled = current_index <= 0;
        wrap.querySelector(".opd_custom_move_right").disabled = current_index >= columns.length - 1;
    }

    function add_controls(section){
        const bar = section.querySelector(".column_bar");
        if(bar == null || bar.querySelector("." + CONTROL_CLASS) != null){
            return false;
        }
        //カラム設定ボタンと同じ行に置く
        const settings_btn = bar.querySelector(".opd_settings_btn");
        if(settings_btn == null){
            return false;
        }
        const anchor = settings_btn.closest("span.dsp_column_btn");
        if(anchor == null){
            return false;
        }

        const wrap = section.ownerDocument.createElement("span");
        wrap.className = "dsp_column_btn " + CONTROL_CLASS;
        wrap.innerHTML = '<input type="button" class="opd_custom_move_left" value="◀" title="左へ移動">'
            + '<select class="opd_custom_move_select" title="表示順"></select>'
            + '<input type="button" class="opd_custom_move_right" value="▶" title="右へ移動">';
        anchor.insertAdjacentElement("afterend", wrap);

        wrap.querySelector(".opd_custom_move_left").addEventListener("click", function(){
            const columns = get_columns(section);
            move_to(section, columns.indexOf(section) - 1);
        });
        wrap.querySelector(".opd_custom_move_right").addEventListener("click", function(){
            const columns = get_columns(section);
            move_to(section, columns.indexOf(section) + 1);
        });
        wrap.querySelector("select").addEventListener("change", function(){
            move_to(section, parseInt(this.value, 10));
        });
        return true;
    }

    //カラムの追加や削除で並び順が変わるため、その都度呼ぶ
    function setup(deck_document){
        const sections = deck_document.querySelectorAll('#opd_main_element section[draggable="true"]');
        sections.forEach(function(section){
            add_controls(section);
            refresh(section);
        });
    }

    return {
        setup: setup,
        move_to: move_to
    };
})();
