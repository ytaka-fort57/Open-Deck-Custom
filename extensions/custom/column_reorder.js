//カラムの並び替え
//本家はドラッグ＆ドロップでしか並び替えられず操作しづらいため、
//左右ボタンと表示順の選択をカラムバーに足す。
//
//並び順の保存(column_settings_save)は本家の内部関数で直接は呼べない。
//本家のdropハンドラーが「要素の移動」と「保存」を両方行うため、
//dropイベントを発火させて本家の経路にそのまま乗せる。
window.opd_custom_column_reorder = (function(){
    const CONTROL_CLASS = "opd_custom_reorder";
    const STYLE_ATTR = "opd_custom_reorder_css";

    function add_style(doc){
        if(doc.querySelector("style[" + STYLE_ATTR + "]") != null){
            return;
        }
        //カラムバーは flex。縮められて消えないよう flex-shrink を切る
        doc.querySelector("head").insertAdjacentHTML("beforeend", `<style ${STYLE_ATTR}>
        .${CONTROL_CLASS}{
            display: flex;
            flex-direction: row;
            align-items: center;
            flex-shrink: 0;
            margin-right: 5px;
        }
        .${CONTROL_CLASS} input[type="button"]{
            width: 16px;
            min-width: 16px;
            height: 18px;
            padding: 0;
            margin: 0;
            font-size: 9px;
            line-height: 1;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            background-color: #ffffff26;
            color: inherit;
        }
        .${CONTROL_CLASS} input[type="button"]:hover:not(:disabled){
            background-color: #ffffff59;
        }
        .${CONTROL_CLASS} input[type="button"]:disabled{
            opacity: 0.3;
            cursor: default;
        }
        .${CONTROL_CLASS} select{
            height: 18px;
            margin: 0 2px;
            padding: 0;
            font-size: 10px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            background-color: #ffffff26;
            color: inherit;
        }
        </style>`);
    }

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

    //本家のdropハンドラーへ処理を渡す。
    //
    //本家は insertBefore で移動するが、iframeはDOM上で動かすと中身が作り直される。
    //(実測: 移動したカラムだけ再読み込みが走る。本家のドラッグ＆ドロップでも同じ)
    //moveBefore は状態を保ったまま移動できるため、dropを発火する間だけ差し替える。
    //未対応のブラウザーでは従来どおり insertBefore が使われ、再読み込みが起きるだけ。
    function dispatch_drop(section, drop_target){
        const original_insert_before = Node.prototype.insertBefore;
        Node.prototype.insertBefore = function(node, reference){
            if(this.moveBefore != undefined && node.isConnected && node.parentNode === this){
                try{
                    return this.moveBefore(node, reference);
                }catch(error){
                    //moveBeforeが使えない条件のときは従来どおり動かす
                }
            }
            return original_insert_before.call(this, node, reference);
        };
        try{
            const transfer = new DataTransfer();
            transfer.setData("text/plain", section.id);
            drop_target.dispatchEvent(new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true
            }));
        }finally{
            //差し替えは本家のdrop処理の間だけに留める
            Node.prototype.insertBefore = original_insert_before;
        }
    }

    //タイムラインカラムを左からの並び順で返す。タブの保存はこの位置を鍵にしている
    function get_timeline_sections(doc){
        return Array.from(doc.querySelectorAll('#opd_main_element div[opd_column_type="home"]'))
            .map(function(column){
                return column.closest("section");
            });
    }

    //保存したタブをカラムに追従させる。
    //
    //本家のプロファイルから見るとタイムラインカラムはどれも同じ type で区別が付かず、
    //カラムを識別しているのはこちらのタブ保存だけ。位置を鍵にしているため、
    //付け替えないとリロード時に旧配置のタブが割り当てられ、移動が無かったことになる。
    function remap_tab_state(before_sections, after_sections){
        const state_api = window.opd_custom_column_state;
        if(state_api == undefined){
            return;
        }
        state_api.get_profile_index(function(profile_index){
            state_api.load_all(function(state){
                const prefix = profile_index + ":";
                const next_state = {};
                //他のプロファイルの保存はそのまま残す
                Object.keys(state).forEach(function(key){
                    if(key.indexOf(prefix) != 0){
                        next_state[key] = state[key];
                    }
                });
                after_sections.forEach(function(section, new_index){
                    const old_index = before_sections.indexOf(section);
                    if(old_index < 0){
                        return;
                    }
                    const label = state[prefix + old_index];
                    if(label != undefined){
                        next_state[prefix + new_index] = label;
                    }
                });
                state_api.save_all(next_state);
            });
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
        const timeline_before = get_timeline_sections(section.ownerDocument);
        dispatch_drop(section, drop_target);
        remap_tab_state(timeline_before, get_timeline_sections(section.ownerDocument));
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
        //カラム設定ボタンと同じ行の、既存ボタンより右に置く。
        //バーの空き領域(伸縮する)の手前が、幅に余裕があり既存アイコンとも並びが揃う
        const empty_area = bar.querySelector(".dsp_column_empty_area");
        const settings_btn = bar.querySelector(".opd_settings_btn");
        const anchor = empty_area != null
            ? empty_area
            : (settings_btn != null ? settings_btn.closest("span.dsp_column_btn") : null);
        if(anchor == null){
            return false;
        }

        //本家の dsp_column_btn は input を opacity:0 にして label のアイコンを見せる方式で、
        //幅も20px固定。そのクラスに乗せるとボタンが透明になり幅も足りないため、独自に持つ
        add_style(section.ownerDocument);

        const wrap = section.ownerDocument.createElement("span");
        wrap.className = CONTROL_CLASS;
        wrap.innerHTML = '<input type="button" class="opd_custom_move_left" value="◀" title="左へ移動">'
            + '<select class="opd_custom_move_select" title="表示順"></select>'
            + '<input type="button" class="opd_custom_move_right" value="▶" title="右へ移動">';
        if(anchor.classList.contains("dsp_column_empty_area")){
            anchor.insertAdjacentElement("beforebegin", wrap);
        }else{
            anchor.insertAdjacentElement("afterend", wrap);
        }

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
