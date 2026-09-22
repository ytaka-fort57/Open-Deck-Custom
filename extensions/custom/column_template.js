//カラム種別ごとのHTML骨格とカラム設定パネルを組み立てる。
//文言(t)とURL(url)は呼び出し側から受け取り、DOMにもchrome APIにも触れない純粋関数にする。
window.opd_custom_column_template = (function(){
    const SMALL_BUTTON_STYLE = "vertical-align: text-top;font-size: 0.8rem;";
    const EMPTY_ICON_FILTER = "filter: brightness(0) saturate(100%) invert(61%) sepia(13%) saturate(13%) hue-rotate(335deg) brightness(89%) contrast(79%);";

    //種別ごとの差分はここだけに置く。
    //bar: タイトルバーのボタン構成("post" は設定ボタンのみ) / pin: ピン留めボタンを出すか
    //auto_reload: 設定パネルに自動更新の2項目を出すか / hover_reload: iframeに auto_reload_mouse_hover を付けるか
    //(通知カラムは本家由来で auto_reload_mouse_hover を持たない)
    const COLUMN_TYPES = {
        post:{title:"ui_column_post_title", bar:"post", pin:false, auto_reload:false, hover_reload:true, src:"https://x.com/intent/tweet", attrs:""},
        home:{title:"ui_column_timeline_title", bar:"default", pin:false, auto_reload:true, hover_reload:true, src:"https://x.com/home", attrs:""},
        notification:{title:"ui_column_notifications_title", bar:"default", pin:false, auto_reload:false, hover_reload:false, src:"https://x.com/notifications", attrs:""},
        explore:{title:"ui_column_explore_title", bar:"default", pin:true, auto_reload:true, hover_reload:true, src:"https://x.com%column_save_path%", attrs:` opd_explore_path="%column_save_path%" opd_explore_title="%column_save_title%" opd_pinned_path="%column_pinned_save_path%"`},
    };

    function settings_row(label, control){
        return `<div class="dsp_column_settings_content_div">${label}<span>${control}</span></div>`;
    }

    function options(t, keys){
        return keys.map((key, index) => `<option value="${index}">${t(key)}</option>`).join("");
    }

    function settings_panel(t, auto_reload){
        const rows = [
            settings_row(t("ui_settings_view_mode_label"), `<select class="opd_tw_view_mode" column_tw_view_mode_val="%column_tw_view_mode%">${options(t, ["ui_settings_view_mode_all", "ui_settings_view_mode_text_only", "ui_settings_view_mode_media_only"])}</select>`),
            settings_row(t("ui_settings_column_width_label"), `<select class="opd_column_size_preset">${options(t, ["ui_settings_column_width_small", "ui_settings_column_width_medium", "ui_settings_column_width_large", "ui_settings_column_width_custom"])}</select>`),
            settings_row(t("ui_settings_column_width_custom_label"), `<input type="button" class="column_width_btn" value="${t("ui_settings_column_width_custom_button")}" style="${SMALL_BUTTON_STYLE}"/>`),
        ];
        if(auto_reload){
            rows.push(
                settings_row(t("ui_settings_auto_reload_label"), `<input class="opd_a_reload_bar" type="checkbox" %column_auto_reload_ch%>`),
                settings_row(t("ui_settings_auto_reload_interval_label"), `<input class="opd_column_settings_input_text opd_a_reload_time_setting" type="number" value="%column_auto_reload_time%">${t("ui_settings_seconds_suffix")}`),
            );
        }
        return `<div class="dsp_column_settings_panel"><div class="dsp_column_settings_panel_content"><h2>${t("ui_settings_header")}</h2><div class="dsp_column_settings_list">${rows.join("")}</div><div class="dsp_column_settings_panel_close_btn_wrap"><input type="button" class="dsp_column_settings_panel_close_btn" value="${t("ui_settings_close_button")}" style="${SMALL_BUTTON_STYLE}"/></div></div></div>`;
    }

    function bar_button(inner){
        return `<span class="dsp_column_btn">${inner}</span>`;
    }

    function bar_buttons(t, spec){
        const settings = bar_button(`<label class="dsp_column_settings_btn opd_ui_icon_color" title="${t("ui_column_settings_title")}"><input class="opd_settings_btn" type="button" value="S"></label>`);
        const buttons = spec.bar == "post" ? [settings] : [
            bar_button(`<label class="dsp_column_reload_icon opd_ui_icon_color" title="${t("ui_column_reload_title")}"><input class="opd_column_reload_btn" type="button" value="R"></label>`),
            settings,
            bar_button(`<input class="opd_banner" type="checkbox" title="${t("ui_column_banner_toggle_title")}" %column_banner_ch%><label class="dsp_column_banner_btn opd_ui_icon_color"></label>`),
            bar_button(`<input class="opd_top_bar" type="checkbox" title="${t("ui_column_top_toggle_title")}" %column_top_bar_ch%><label class="dsp_column_top_btn opd_ui_icon_color"></label>`),
        ];
        if(spec.pin){
            buttons.push(bar_button(`<input class="opd_pinned_btn" type="checkbox" title="${t("ui_column_pin_toggle_title")}" %column_pinned_ch%><label class="dsp_column_pin_btn opd_ui_icon_color"></label>`));
        }
        return buttons.join("");
    }

    function column_html(t, type){
        const spec = COLUMN_TYPES[type];
        const hover = spec.hover_reload ? `auto_reload_mouse_hover="false" ` : "";
        const title_bar = `<div class="column_bar" style="height: max-content;"><span class="dsp_column_title"><div class="dsp_column_move_icon_parent"><span class="dsp_column_move_icon"></span><span>${t(spec.title)}</span></div></span>${bar_buttons(t, spec)}<div class="dsp_column_empty_area opd_column_scroll_to_top"></div><div class="dsp_column_close_btn_wrap">${bar_button(`<label class="dsp_column_close_btn opd_ui_icon_color" title="${t("ui_column_close_title")}"><input type="button" class="column_close_btn" value="X"/></label>`)}</div></div>`;
        const iframe = `<iframe ${hover}allow="fullscreen" src="${spec.src}" type="text/html" style="width: 100%;height: 100%;" opd_init_webview></iframe>`;
        return `<section draggable="true" id="column_%column_num%" class="dsp_column_draggable_true dsp_column"><div opd_column_type="${type}" opd_column_width="%column_width_num%"${spec.attrs} style="height: 100%;width: %column_width_num%rem;min-width: 1rem;">${title_bar}${settings_panel(t, spec.auto_reload)}${iframe}</div></section>`;
    }

    function empty_column_html(t, url, type, class_name, icon, message_key, extra_style){
        return `<section draggable="false" id="column_%column_num%" class="dsp_column_draggable_false dsp_column ${class_name}"><div opd_column_type="${type}" opd_column_width="%column_width_num%" style="${extra_style}display: flex;align-items: center;justify-content: center;"><div><img src="${url(icon)}" style="${EMPTY_ICON_FILTER}"><p>${t(message_key)}</p></div></div></section>`;
    }

    //content.js の default_element と同じ形({種別: {html}})で返す。
    function build(t, url, icons){
        return {
            empty_column:{html:empty_column_html(t, url, "empty_column", "dsp_column_emptycolumn", icons.column_add_1, "ui_empty_column_message", "height: 100%;min-width: 30rem;")},
            post:{html:column_html(t, "post")},
            second_empty_column:{html:empty_column_html(t, url, "second_empty_column", "dsp_column_second_emptycolumn", icons.column_add_2, "ui_second_empty_column_message", "height:100%;min-width: 30rem;overflow: hidden;")},
            home:{html:column_html(t, "home")},
            notification:{html:column_html(t, "notification")},
            explore:{html:column_html(t, "explore")},
        };
    }

    return {
        COLUMN_TYPES,
        build,
        column_html,
        settings_panel,
    };
})();
