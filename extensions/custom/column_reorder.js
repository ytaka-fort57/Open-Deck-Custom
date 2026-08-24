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

    function get_direct_sections(rack){
        return Array.from(rack?.children ?? []).filter(function(element){
            return element.tagName === "SECTION";
        });
    }

    //iframeを含むsectionをDOMから移動すると、ブラウザーによってはiframeが再読み込みされる。
    //表示順はflexのorderで変更し、iframeをDOMから外さない。
    function get_visual_sections(rack){
        return get_direct_sections(rack)
            .map(function(section, index){
                const raw_order = section.style.order;
                const order = raw_order === "" ? Number.POSITIVE_INFINITY : Number(raw_order);
                return {section: section, index: index, order: Number.isNaN(order) ? index : order};
            })
            .sort(function(left, right){
                return left.order - right.order || left.index - right.index;
            })
            .map(function(item){
                return item.section;
            });
    }

    function apply_visual_order(rack, sections){
        sections.forEach(function(section, index){
            section.style.order = String(index);
        });
    }

    function get_racks(doc){
        if(typeof doc?.querySelector !== "function"){
            return [];
        }
        return [
            doc.querySelector("#first_rack_element"),
            doc.querySelector("#second_rack_element")
        ].filter(function(rack){
            return rack != null;
        });
    }

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
        return get_visual_sections(rack).filter(function(element){
            return element.tagName === "SECTION" && element.getAttribute("draggable") === "true";
        });
    }

    function get_visual_column_elements(doc){
        const all_elements = Array.from(doc.querySelectorAll("#opd_main_element div[opd_column_type]"));
        const ordered_elements = get_racks(doc).flatMap(function(rack){
            return get_visual_sections(rack).map(function(section){
                return Array.from(section.children).find(function(element){
                    return element.getAttribute?.("opd_column_type") != null;
                });
            }).filter(function(element){
                return element != null;
            });
        });
        const ordered_set = new Set(ordered_elements);
        const result = [];
        let inserted = false;
        all_elements.forEach(function(element){
            if(!ordered_set.has(element)){
                result.push(element);
            }else if(!inserted){
                result.push(...ordered_elements);
                inserted = true;
            }
        });
        return result;
    }

    function move_before(section, target){
        if(section == null || target == null || section === target){
            return false;
        }
        const source_rack = section.parentElement;
        const target_rack = target.parentElement;
        if(source_rack == null || target_rack == null){
            return false;
        }
        // CSS order cannot move an element across flex containers. Returning false
        // lets the existing native drop handler perform the actual DOM move.
        if(source_rack !== target_rack){
            return false;
        }
        const source_sections = get_visual_sections(source_rack).filter(function(item){
            return item !== section;
        });
        const target_sections = source_sections;
        const target_index = target_sections.indexOf(target);
        if(target_index < 0){
            return false;
        }
        target_sections.splice(target_index, 0, section);
        apply_visual_order(source_rack, target_sections);
        return true;
    }

    //タイムラインカラムを左からの並び順で返す。タブの保存はこの位置を鍵にしている
    function get_timeline_sections(doc){
        if(typeof doc?.querySelector !== "function"){
            return Array.from(doc.querySelectorAll('#opd_main_element div[opd_column_type="home"]'))
                .map(function(column){
                    return column.closest("section");
                });
        }
        return get_racks(doc).flatMap(function(rack){
            return get_visual_sections(rack).filter(function(section){
                return section.querySelector('div[opd_column_type="home"]') != null;
            });
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
            state_api.update_all(function(state){
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
                return next_state;
            });
        });
    }

    //本家側のドラッグ、追加、削除からも同じ再配置処理を利用する
    function snapshot_timeline_sections(doc){
        return get_timeline_sections(doc);
    }

    function remap_after_dom_change(before_sections, doc){
        if(before_sections == null){
            return;
        }
        remap_tab_state(before_sections, get_timeline_sections(doc));
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
        const visual_sections = get_visual_sections(section.parentElement).filter(function(item){
            return item !== section;
        });
        const target_column = columns[target_index];
        let insert_index = visual_sections.indexOf(target_column);
        if(target_index > current_index){
            insert_index += 1;
        }
        if(insert_index < 0){
            return false;
        }
        const timeline_before = get_timeline_sections(section.ownerDocument);
        visual_sections.splice(insert_index, 0, section);
        apply_visual_order(section.parentElement, visual_sections);
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
        get_racks(deck_document).forEach(function(rack){
            apply_visual_order(rack, get_visual_sections(rack));
        });
        sections.forEach(function(section){
            add_controls(section);
            refresh(section);
        });
    }

    return {
        get_visual_column_elements: get_visual_column_elements,
        move_before: move_before,
        setup: setup,
        move_to: move_to,
        snapshot_timeline_sections: snapshot_timeline_sections,
        remap_after_dom_change: remap_after_dom_change
    };
})();
