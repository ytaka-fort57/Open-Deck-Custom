//カラム設定のDOM境界をまとめる
//content.jsの保存形式は変えず、DOMからの読み取りとtemplate値の組み立てだけを担当する
window.opd_custom_column_settings = (function(){
    const safe_values = window.opd_custom_safe_values;
    const AUTO_RELOAD_TYPES = new Set(["home", "explore"]);
    const VIEW_MODES = new Set(["0", "1", "2"]);
    //カラム幅プリセット(rem)。select の value 0/1/2 に対応し、それ以外は 3(カスタム)
    const WIDTH_PRESETS = [15, 20, 30];
    //切替ダイアログに出すExploreカラムのタイトルの最大文字数
    const SUMMARY_TITLE_MAX = 40;

    function is_auto_reload_type(type){
        return AUTO_RELOAD_TYPES.has(type);
    }

    //幅(rem)から select の value を求める。プリセット外はカスタム(=プリセット数)
    function width_preset_index(width){
        const index = WIDTH_PRESETS.indexOf(Number(width));
        return index === -1 ? WIDTH_PRESETS.length : index;
    }

    //select の value から幅(rem)を求める。カスタムや不正値は最大プリセットに寄せる
    function width_from_preset(index){
        const key = String(index);
        const width = /^\d+$/.test(key) ? WIDTH_PRESETS[Number(key)] : undefined;
        return width ?? WIDTH_PRESETS[WIDTH_PRESETS.length - 1];
    }

    function is_checked(column, selector){
        return column.querySelector?.(selector)?.checked === true;
    }

    function string_value(value, fallback = ""){
        return typeof value === "string" ? value : fallback;
    }

    //Xのページタイトルは未読件数 "(3) " とサービス名 " / X" が付く。
    //同じページでも変わるため、保存するタイトルからは落とす
    function normalize_explore_title(title){
        if(typeof title !== "string"){
            return "";
        }
        return title
            .replace(/\s*\/\s*X$/, "")
            .replace(/^\(\d+\)\s*/, "")
            .trim();
    }

    //XはSPA遷移でURLを変えたあとに document.title を書き換えるため、URL変更の通知では
    //タイトルがまだ前のページのものになっている。両者を別々に比べ、変わった項目だけ返す。
    //遷移途中の空タイトルでは上書きしない
    function explore_state_changes(previous, current){
        const changes = {};
        if(current == null){
            return changes;
        }
        if(typeof current.path === "string" && previous?.href !== current.href){
            changes.column_save_path = current.path;
        }
        const title = normalize_explore_title(current.title);
        if(title !== "" && normalize_explore_title(previous?.title) !== title){
            changes.column_save_title = title;
        }
        return changes;
    }

    function normalize(input = {}, fallback = {}){
        const source = Object.assign({}, fallback, input ?? {});
        const type = string_value(source.type, "empty_column");
        const raw_view_mode = String(source.tw_view_mode ?? "0");
        const raw_width = source.column_width;
        const raw_interval = Number(source.auto_reload_time);

        return {
            type: type,
            banner: source.banner === true,
            top_visible: source.top_visible === true,
            tw_view_mode: VIEW_MODES.has(raw_view_mode) ? raw_view_mode : "0",
            column_save_path: string_value(source.column_save_path),
            column_save_title: string_value(source.column_save_title),
            column_pinned_path: string_value(source.column_pinned_path),
            auto_reload: is_auto_reload_type(type) ? source.auto_reload === true : null,
            auto_reload_time: Number.isFinite(raw_interval) && raw_interval >= 1000
                ? raw_interval
                : 10000,
            column_width: raw_width == null || raw_width === "null"
                ? null
                : String(raw_width),
        };
    }

    function read(column){
        const type = column.getAttribute("opd_column_type");
        const view_mode = column.querySelector?.(".opd_tw_view_mode")?.value;
        const settings = normalize({
            type: type,
            banner: is_checked(column, ".opd_banner"),
            top_visible: is_checked(column, ".opd_top_bar"),
            tw_view_mode: view_mode == undefined ? "0" : view_mode,
            column_width: column.getAttribute("opd_column_width") === "null"
                ? null
                : column.getAttribute("opd_column_width"),
        });

        if(type === "explore"){
            return normalize({
                ...settings,
                column_save_path: column.getAttribute("opd_explore_path"),
                column_pinned_path: column.getAttribute("opd_pinned_path"),
                column_save_title: column.getAttribute("opd_explore_title"),
                auto_reload: is_checked(column, ".opd_a_reload_bar"),
                auto_reload_time: Number(column.querySelector?.(".opd_a_reload_time_setting")?.value) * 1000,
            });
        }

        if(is_auto_reload_type(type)){
            settings.auto_reload = is_checked(column, ".opd_a_reload_bar");
            const seconds = Number(column.querySelector?.(".opd_a_reload_time_setting")?.value);
            settings.auto_reload_time = seconds * 1000 >= 1000
                ? seconds * 1000
                : 10000;
        }

        return normalize(settings);
    }

    function render_values(setting, column_id, fallback_width = "30"){
        setting = normalize(setting);
        const type = setting?.type;
        const pinned_path = type === "explore" && setting.column_pinned_path != null
            ? setting.column_pinned_path
            : "";
        const save_path = type === "explore"
            ? (pinned_path || setting.column_save_path || "")
            : (setting.column_save_path || "");
        const auto_reload_time = Number(setting?.auto_reload_time) / 1000;

        return {
            "%column_save_path%": save_path,
            "%column_num%": column_id,
            "%column_banner_ch%": setting?.banner === true ? "checked" : "",
            "%column_top_bar_ch%": setting?.top_visible === true ? "checked" : "",
            "%column_tw_view_mode%": setting?.tw_view_mode ?? "0",
            "%column_pinned_ch%": pinned_path === "" ? "" : "checked",
            "%column_pinned_save_path%": pinned_path,
            "%column_save_title%": setting?.column_save_title || "",
            "%column_width_num%": setting?.column_width == null
                ? fallback_width
                : setting.column_width,
            "%column_auto_reload_ch%": is_auto_reload_type(type) && setting?.auto_reload === true
                ? "checked"
                : "",
            "%column_auto_reload_time%": Number.isFinite(auto_reload_time) && auto_reload_time >= 1
                ? auto_reload_time
                : 10,
        };
    }

    function render(template, setting, column_id, fallback_width = "30"){
        if(safe_values?.render_attribute_template == null){
            throw new Error("Open-Deckの安全なtemplate rendererがありません");
        }
        return safe_values.render_attribute_template(
            template,
            render_values(setting, column_id, fallback_width)
        );
    }

    function new_column_setting(type){
        return normalize({
            type: type,
            top_visible: true,
            column_save_path: type === "explore" ? "/explore" : "",
            column_width: "30",
        });
    }

    //初期化時の既定プロファイル(1段目: タイムライン・通知・Explore)。
    //new_column_setting と同じ既定値から組み立て、home だけバナー表示にする。
    //column_width は null(描画時に既定幅を継承)、auto_reload は本家の初期値どおり false のまま保存する
    function default_profile(){
        return ["main_bar_empty_column", "home", "notification", "explore", "empty_column"].map(function(type){
            return Object.assign(new_column_setting(type), {
                banner: type === "home",
                auto_reload: false,
                column_width: null,
            });
        });
    }

    function new_column_values(type, column_id){
        return render_values(new_column_setting(type), column_id, "30");
    }

    function render_profile(profile, templates, create_id, fallback_width = "30"){
        let first_rack_html = "";
        let second_rack_html = "";
        let first_rack_ended = false;
        let second_rack_ended = false;
        let inherited_width = fallback_width;

        Array.from(profile ?? []).forEach(function(raw_setting){
            const setting = normalize(raw_setting);
            const template_entry = templates?.[setting.type];
            const template = typeof template_entry === "string"
                ? template_entry
                : template_entry?.html;
            if(typeof template !== "string"){
                return;
            }
            if(setting.column_width != null){
                inherited_width = setting.column_width;
            }
            const html = render(template, setting, create_id(), inherited_width);
            if(first_rack_ended){
                second_rack_html += html;
            }else{
                first_rack_html += html;
            }
            if(!first_rack_ended && setting.type === "empty_column"){
                first_rack_ended = true;
            }
            if(!second_rack_ended && setting.type === "second_empty_column"){
                second_rack_ended = true;
            }
        });

        return {
            first_rack_html: first_rack_html,
            second_rack_html: second_rack_html,
            first_rack_ended: first_rack_ended,
            second_rack_ended: second_rack_ended,
        };
    }

    //検索パスは日本語がパーセント符号化されていて読めないため、表示用に戻す
    function decode_summary_path(path){
        const value = string_value(path);
        try{
            return decodeURIComponent(value);
        }catch(error){
            //壊れた符号化はそのまま出す
            return value;
        }
    }

    //切替ダイアログは1行が長いと読めないため、タイトルは頭だけ残す
    function shorten_summary_title(title){
        const value = string_value(title).trim();
        return value.length > SUMMARY_TITLE_MAX
            ? `${value.slice(0, SUMMARY_TITLE_MAX)}…`
            : value;
    }

    //Exploreカラムは保存時に見ていたページのタイトルだけでは見分けられないため、
    //読み込まれるパスを添える。ピン留め中はピン留めパスが読み込まれ、タイトルは
    //その後に見たページのものになっているので、パスとピン留めの印だけを出す
    function explore_summary_label(column, i18n_message){
        const pinned_path = string_value(column?.column_pinned_path);
        if(pinned_path !== ""){
            return `${decode_summary_path(pinned_path)} (${i18n_message("msg_profile_desc_pinned_mark")})`;
        }
        const save_path = decode_summary_path(column?.column_save_path);
        const title = shorten_summary_title(column?.column_save_title);
        if(title === ""){
            return save_path;
        }
        return save_path === "" ? title : `${title} (${save_path})`;
    }

    //プロファイル切替の確認ダイアログに出す説明文。描画対象カラムだけを連番化し、
    //段の区切り(empty_column / second_empty_column)でだけ連番を1へ戻す。
    function profile_summary(profile, i18n_message){
        const lines = [];
        let count = 1;
        Array.from(profile ?? []).forEach(function(column){
            switch (column?.type) {
                case "empty_column":
                    lines.push(i18n_message("msg_profile_desc_first_row_end"));
                    count = 1;
                    return;
                case "second_empty_column":
                    lines.push(i18n_message("msg_profile_desc_second_row_end"));
                    count = 1;
                    return;
                case "main_bar_empty_column":
                case "dsp_column":
                    return;
                case "post":
                    lines.push(i18n_message("msg_profile_desc_post_column", [count]));
                    break;
                case "home":
                    lines.push(i18n_message("msg_profile_desc_timeline_column", [count]));
                    break;
                case "notification":
                    lines.push(i18n_message("msg_profile_desc_notification_column", [count]));
                    break;
                case "explore":
                    lines.push(i18n_message("msg_profile_desc_explore_column", [count, explore_summary_label(column, i18n_message)]));
                    break;
                default:
                    lines.push(`${count}-${String(column?.type ?? "unknown")}`);
                    break;
            }
            count += 1;
        });
        return lines;
    }

    function read_profile(doc, reorder_api){
        const column_elements = reorder_api?.get_visual_column_elements?.(doc)
            ?? Array.from(doc?.querySelectorAll?.("#opd_main_element div[opd_column_type]") ?? []);
        return column_elements
            .filter(function(column){
                return column.getAttribute?.("opd_column_type") !== "dsp_column";
            })
            .map(read);
    }

    return {
        normalize: normalize,
        read: read,
        read_profile: read_profile,
        profile_summary: profile_summary,
        normalize_explore_title: normalize_explore_title,
        explore_state_changes: explore_state_changes,
        render: render,
        render_profile: render_profile,
        render_values: render_values,
        new_column_setting: new_column_setting,
        new_column_values: new_column_values,
        default_profile: default_profile,
        WIDTH_PRESETS: WIDTH_PRESETS,
        width_preset_index: width_preset_index,
        width_from_preset: width_from_preset,
    };
})();
