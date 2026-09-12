//カラム設定のDOM境界をまとめる
//content.jsの保存形式は変えず、DOMからの読み取りとtemplate値の組み立てだけを担当する
window.opd_custom_column_settings = (function(){
    const AUTO_RELOAD_TYPES = new Set(["home", "explore"]);

    function is_auto_reload_type(type){
        return AUTO_RELOAD_TYPES.has(type);
    }

    function is_checked(column, selector){
        return column.querySelector?.(selector)?.checked === true;
    }

    function read(column){
        const type = column.getAttribute("opd_column_type");
        const view_mode = column.querySelector?.(".opd_tw_view_mode")?.value;
        const settings = {
            type: type,
            banner: is_checked(column, ".opd_banner"),
            top_visible: is_checked(column, ".opd_top_bar"),
            tw_view_mode: view_mode == undefined ? "0" : view_mode,
            column_save_path: "",
            column_save_title: null,
            column_pinned_path: "",
            auto_reload: null,
            auto_reload_time: 10000,
            column_width: column.getAttribute("opd_column_width") === "null"
                ? null
                : column.getAttribute("opd_column_width"),
        };

        if(type === "explore"){
            settings.column_save_path = column.getAttribute("opd_explore_path");
            settings.column_pinned_path = column.getAttribute("opd_pinned_path");
            settings.column_save_title = column.getAttribute("opd_explore_title");
        }

        if(is_auto_reload_type(type)){
            settings.auto_reload = is_checked(column, ".opd_a_reload_bar");
            const seconds = Number(column.querySelector?.(".opd_a_reload_time_setting")?.value);
            settings.auto_reload_time = seconds * 1000 >= 1000
                ? seconds * 1000
                : 10000;
        }

        return settings;
    }

    function render_values(setting, column_id, fallback_width = "30"){
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

    function new_column_values(type, column_id){
        const defaults = {
            type: type,
            banner: false,
            top_visible: true,
            tw_view_mode: "0",
            column_save_path: type === "explore" ? "/explore" : "",
            column_save_title: "",
            column_pinned_path: "",
            auto_reload: false,
            auto_reload_time: 10000,
            column_width: "30",
        };
        return render_values(defaults, column_id, "30");
    }

    return {
        read: read,
        render_values: render_values,
        new_column_values: new_column_values,
    };
})();
