console.log("Welcome to Open-Deck!");
const manifest = chrome.runtime.getManifest();
//試作版の場合は true にする
const is_prototype = false;
if(is_prototype){
    console.log("%cOpen-Deck Prototype", "background:#a1f4ff;padding:5px;border-radius:5px", `Version:${manifest.version}`);
}else{
    console.log("%cOpen-Deck", "background:#a1f4ff;padding:5px;border-radius:5px", `Version:${manifest.version}`);
}
//
const url_path = new URL(location.href);
let is_added_system_color_mode = false;
let apply_ui_color = null;
let system_color_scheme = null;
const i18n_message = chrome.i18n.getMessage;
let profile_store;
let last_load_profile = 0;
let is_removed_default_style = false;
const deck_lifecycle = window.opd_custom_lifecycle;
const deck_storage = window.opd_custom_storage;
const deck_safe_values = window.opd_custom_safe_values;
//ランダムID作成(text_review と実体を共通化)
const create_random_id = deck_safe_values.create_random_id;
const column_settings = window.opd_custom_column_settings;
const column_dom = window.opd_custom_column_dom;
const column_frame_css = window.opd_custom_column_frame_css;
let shared_media_viewer = null;
const column_auto_update_state = {
    text_focus: {date: 0, active: false},
    media_viewer: {active: false},
};
const ui_icon_define = {
    banner_hide:"icon/banner_hide.svg",
    top_bar_hide:"icon/top_hide.svg",
    column_move:"icon/column_move.svg",
    column_close:"icon/column_close.svg",
    column_settings: "icon/settings.svg",
    column_pin:"icon/pin.svg",
    column_pinned:"icon/pinned.svg",
    column_widesize:"icon/column_w_size.svg",
    column_add_1:"icon/column_add_1st.svg",
    column_add_2:"icon/column_add_2nd.svg",
    add_post_column:"icon/post.svg",
    add_timeline_column:"icon/tl_column.svg",
    add_notification_column:"icon/notice_column.svg",
    add_explore_column:"icon/exp_column.svg",
    column_single_rack:"icon/single_view.svg",
    column_second_rack:"icon/second_view.svg",
    profile_save:"icon/profile_save.svg",
    profile_delete:"icon/profile_delete.svg",
    text_review:"icon/text_review.svg",
    forward:"icon/forward.svg",
    next:"icon/next.svg",
    download:"icon/download.svg",
    hashtag_restore:"icon/hashtag_restore.svg",
    column_reload:"icon/column_reload.svg",
}

//UNIX時間分秒変換
function unix_time_mmss(input){
    const date = new Date(input * 1000);
    return date.toLocaleTimeString();
}
//ストレージの書き込み監視(主にAPIリミット監視に使う)
let api_limit_obj = null;
let api_limit_dsc_obj = {time_line:"", recommend_timeline:"", search:""};
chrome.storage.onChanged.addListener((changes, namespace) => {
    if(changes.api_access_limit != undefined){
        api_limit_obj = changes.api_access_limit.newValue;
        const api_linit_status_btn = document.querySelector("#api_limit_status");
        if(api_linit_status_btn != null){
            let timeline_limit_percentage = 99999;
            let recommend_timeline_limit_percentage = 99999;
            let search_limit_percentage = 99999;
            if(api_limit_obj.time_line.remaining != null){
                timeline_limit_percentage = api_limit_obj.time_line.remaining / api_limit_obj.time_line.limit * 100;
                api_limit_dsc_obj.time_line = `${i18n_message("label_api_timeline")}${api_limit_obj.time_line.remaining}/${api_limit_obj.time_line.limit}-${unix_time_mmss(api_limit_obj.time_line.reset_unix_time)}\r\n`;
            }else{
                //初期状態
            }
            if(api_limit_obj.recommend_timeline.remaining != null){
                recommend_timeline_limit_percentage = api_limit_obj.recommend_timeline.remaining / api_limit_obj.recommend_timeline.limit * 100;
                api_limit_dsc_obj.recommend_timeline = `${i18n_message("label_api_recommend_timeline")}${api_limit_obj.recommend_timeline.remaining}/${api_limit_obj.recommend_timeline.limit}-${unix_time_mmss(api_limit_obj.recommend_timeline.reset_unix_time)}\r\n`;
            }else{
                //初期状態
            }
            if(api_limit_obj.search.remaining != null){
                search_limit_percentage = api_limit_obj.search.remaining / api_limit_obj.search.limit * 100;
                api_limit_dsc_obj.search = `${i18n_message("label_api_search")}${api_limit_obj.search.remaining}/${api_limit_obj.search.limit}-${unix_time_mmss(api_limit_obj.search.reset_unix_time)}`;
            }else{
                //初期状態
            }
            api_linit_status_btn.textContent = `${Math.floor(Math.min(timeline_limit_percentage, recommend_timeline_limit_percentage, search_limit_percentage))}%`;
            api_linit_status_btn.title = `${i18n_message("msg_api_limit_status_title", [`${api_limit_dsc_obj.time_line}${api_limit_dsc_obj.recommend_timeline}${api_limit_dsc_obj.search}`])}`;
        }
    }
  });
//
if(window.opd_custom_deck_url.is_deck_url(location.href)){
    chrome.runtime.sendMessage({message: "dnr_upd"}).then((value)=>{
        init();
    });
    function init(){
        const storage_defaults = {};
        storage_defaults[deck_storage.KEYS.SETTINGS] = null;
        storage_defaults[deck_storage.KEYS.PROFILE_STORE] = null;
        deck_storage.get_json_many(storage_defaults, function(storage_error, stored){
            if(storage_error != null){
                console.error("Open-Deck settings could not be loaded.", storage_error);
                if(confirm(i18n_message("msg_profile_data_broken_confirm"))){
                    settings_init();
                }
                return;
            }
            const stored_settings = stored[deck_storage.KEYS.SETTINGS];
            if(stored_settings == null){
                last_load_profile = 0;
                settings_init();
                return;
            }
            if(stored_settings.last_load_profile == undefined){
                last_load_profile = 0;
                if(confirm(i18n_message("msg_profile_data_broken_confirm"))){
                    deck_storage.remove(deck_storage.KEYS.SETTINGS, function(){
                        alert(i18n_message("msg_profile_init_completed"));
                    });
                }
            }else{
                last_load_profile = stored_settings.last_load_profile;
            }
            profile_store = stored[deck_storage.KEYS.PROFILE_STORE];
            if(!Array.isArray(profile_store) || profile_store.length === 0){
                if(confirm(i18n_message("msg_profile_data_broken_confirm"))){
                    settings_init();
                }
                return;
            }

            if(profile_store[last_load_profile]?.profile == undefined){
                const recovery_setting = Object.assign({}, stored_settings, {last_load_profile: 0});
                deck_storage.set_json(deck_storage.KEYS.SETTINGS, recovery_setting, function(error){
                    if(error != null){
                        console.error("Open-Deck settings could not be repaired.", error);
                        return;
                    }
                    alert(i18n_message("msg_settings_auto_repair"));
                    last_load_profile = 0;
                    location.reload();
                });
                return;
            }

            const ext_update_flag = stored_settings.version != manifest.version;
            if(ext_update_flag){
                const next_settings = Object.assign({}, stored_settings, {version: manifest.version});
                deck_storage.set_json(deck_storage.KEYS.SETTINGS, next_settings, function(error){
                    if(error == null && confirm(i18n_message("app_update"))){
                        open(`https://github.com/kawa-nobu/Open-Deck/releases/tag/v${manifest.version}`, '_blank', 'popup');
                    }
                });
            }
            //カラムを描画する前にタブ保存の鍵を安定IDへ移す。描画後に移すと、
            //移行前の鍵で復元が始まり移行後の保存と競合する
            ensure_column_state_migrated(function(migrated_profile_store){
                if(Array.isArray(migrated_profile_store) && migrated_profile_store[last_load_profile]?.profile != undefined){
                    profile_store = migrated_profile_store;
                }
                run({column_settings: profile_store[last_load_profile].profile});
            });
        });
    }
}
//カラムごとのタブ保存を位置キーから安定IDへ移す。移せない場合は保存を書き換えず、
//位置キーのまま起動する(独自モジュールが読めない環境も同じ扱い)。
function ensure_column_state_migrated(callback){
    const state_api = window.opd_custom_column_state;
    if(state_api == undefined || state_api.ensure_migrated == undefined){
        callback(null);
        return;
    }
    state_api.ensure_migrated(create_random_id, callback);
}
function run(settings){
    //再構築前のカラムが保持していた監視・イベント・自動更新を確実に停止する
    deck_lifecycle.dispose_column_resources_in(document.querySelector("#opd_main_element"));
    deck_lifecycle.dispose_all_auto_reload();
    function render_profile_buttons(){
        return profile_store.map(function(_profile, index){
            return `<div class="dsp_btn_parent" title="${i18n_message("ui_profile_switch_title")}" id="userProfile-${index}"><div class="dsp_btn_change_profile_btn">P${index}</div></div>`;
        }).join("");
    }
    function render_profile_sidebar(){
        return `<div class="profile_val_now" title="${i18n_message("ui_profile_current_title")}">${last_load_profile}</div><div class="dsp_profile_list"><div id="profile_btn_list">${render_profile_buttons()}</div>`;
    }
    function refresh_profile_list(current_profile_index = null){
        const profile_button_list = document.querySelector("#profile_btn_list");
        if(profile_button_list == null) return;
        profile_button_list.innerHTML = render_profile_buttons();
        if(current_profile_index != null){
            document.querySelector(".profile_val_now").textContent = current_profile_index;
        }
        create_profile_list_btn();
    }
    const profile_list_html = render_profile_sidebar();
    deck_lifecycle.initialize_page_event_listeners({
        on_post_focus: function(detail){
            if(detail){
                column_auto_update_state.text_focus.date = Date.now();
                column_auto_update_state.text_focus.active = true;
            }else{
                column_auto_update_state.text_focus.date = 0;
                column_auto_update_state.text_focus.active = false;
            }
        },
        on_media_info: function(detail){
            if(shared_media_viewer == null){
                shared_media_viewer = new OpdExtMediaViewer();
            }
            column_auto_update_state.media_viewer.active = true;
            shared_media_viewer.Preview(detail.media_info, detail.selected_index, function(){
                column_auto_update_state.media_viewer.active = false;
            });
        },
    });
    //CSSタグ追加。run() はプロファイル切替でも呼ばれるため、1つだけにする
    if(document.querySelector("link[opd_deck_css]") == null){
        document.querySelector("head").insertAdjacentHTML("afterbegin", `<link rel="stylesheet" opd_deck_css href="${chrome.runtime.getURL("deck.css")}">`);
    }
    //カラム要素作成-挿入
    let default_element = window.opd_custom_column_template.build(i18n_message, (path) => chrome.runtime.getURL(path), ui_icon_define);
    let ins_html = document.createElement("div");
    ins_html.id = "opd_main_element";
    ins_html.style = "position: fixed;z-index: 999999;top:0;width: 100%;height: 100%;background: white;display: flex;flex-direction: row;overflow: hidden;";
    let side_bar = `<section class="dsp_column" style="position:fixed;z-index:999;height:98%;"><div draggable="false" class="dsp_column_draggable_false" opd_column_type="dsp_column" opd_column_width="%column_width_num%" style="height:100%;min-width: 60px;max-width: 60px;text-align: center;background-color: white;"><div class="main_bar_functions"><div class="opd_ui_logo_parent" title="${i18n_message("ui_sidebar_logo_title", [manifest.version])}"><div class="opd_ui_logo"></div><span class="opd_version_span">${manifest.version}</span></div><hr><p class="opd_debug_menu">${i18n_message("ui_debug_menu_label")}<br><input type="button" id="init_settings" value="${i18n_message("ui_button_init_settings")}" /><br><input type="button" id="profile_load_save" value="${i18n_message("ui_button_profile_loader")}" /><br><input type="button" id="dnr_reload" value="${i18n_message("ui_button_dnr_reload")}" /><br><input type="button" id="ext_reload" value="${i18n_message("ui_button_ext_reload")}" /><br><div id="api_limit_status">${i18n_message("ui_button_api_label")}</div><hr><div class="dsp_btn_parent" id="add_post" title="${i18n_message("ui_add_post_column_title")}"><div class="dsp_btn_add_post_img"></div></div><hr><div class="dsp_btn_parent" id="add_timeline" title="${i18n_message("ui_add_timeline_column_title")}"><div class="dsp_btn_add_tl_img"></div></div><div class="dsp_btn_parent" id="add_notify" title="${i18n_message("ui_add_notification_column_title")}"><div class="dsp_btn_add_ntfc_img"></div></div><div class="dsp_btn_parent" id="add_explore" title="${i18n_message("ui_add_explore_column_title")}"><div class="dsp_btn_add_explr_img"></div></div><hr><div class="dsp_btn_parent" title="${i18n_message("ui_toggle_second_rack_title")}" id="second_rack"><div class="dsp_btn_second_rack_img"></div></div><hr><div class="dsp_btn_parent" title="${i18n_message("ui_profile_save_title")}" id="profile_save"><div class="dsp_btn_profile_add_img"></div></div><div class="dsp_btn_parent" title="${i18n_message("ui_profile_delete_title")}" id="profile_delete"><div class="dsp_btn_profile_delete_img"></div></div>${profile_list_html}</p></div></div></section><section draggable="false" class="dsp_column_draggable_false dsp_column"><div opd_column_type="main_bar_empty_column" id="main_bar_empty_column" style="height:100%;min-width: 60px;max-width: 60px;"></div></section>`;
    const rendered_profile = column_settings.render_profile(
        settings.column_settings,
        default_element,
        create_random_id,
        "30"
    );
    const main_column_html = rendered_profile.first_rack_html;
    const second_column_html = rendered_profile.second_rack_html;
    const first_column_end = rendered_profile.first_rack_ended;
    const second_column_end = rendered_profile.second_rack_ended;
    let second_rack_mode = false;
    //スクロール検出用
    let scroll_block = true;
    //
    //初期挿入HTML作成
    ins_html.innerHTML = `${side_bar}<div id="main_rack_element" style=""><div id="first_rack_element" style="height: 100%;display:flex;flex-direction:row;">${main_column_html}</div><div id="second_rack_element" style="display:flex;flex-direction:row;">${second_column_html}</div></div>`;
    //HTML挿入
    document.body.insertAdjacentElement("afterbegin", ins_html);

    //favicon・タイトルとページ全体の監視は、プロファイル切り替え後も同じdocumentを使うため1度だけ登録する
    deck_lifecycle.initialize_title_favicon("Open-Deck", chrome.runtime.getURL("icon.png"));
    deck_lifecycle.initialize_page_observers({
        get_react_root: function(){
            return document.getElementById("react-root");
        },
        react_watch_root: document.body,
        on_react_change: main_dsp,
        react_observer_options: {childList: true, characterData: true, subtree: false},
        get_head: function(){
            return document.head;
        },
        head_watch_root: document.documentElement,
        on_head_change: head_observer_callback,
        head_observer_options: {childList: true, subtree: false},
    });
    //APIリミット表示用
    document.querySelector("#api_limit_status").addEventListener("click", function(){
        if(api_limit_obj != null){
            alert(i18n_message("msg_api_limit_status_alert", [`${api_limit_dsc_obj.time_line}${api_limit_dsc_obj.recommend_timeline}${api_limit_dsc_obj.search}`]))
        }
    });
    //Open-Deckについて表示
    document.querySelector(".opd_ui_logo").addEventListener("click", function(){
        window.open(chrome.runtime.getURL("about_opd.html"), "About Open-Deck", 'width=720, height=280');
    });
    //デバッグメニュー表示
    let debug_menu_click_counter = 0;
    document.querySelector(".opd_version_span").addEventListener("click", function(){
        if(debug_menu_click_counter >= 7){
            alert(i18n_message("msg_debug_menu_enabled"));
            document.querySelector(".opd_debug_menu").style.display = "block";
        }else{
            debug_menu_click_counter += 1;
        }
    });
    //2段目が存在する場合の処理
    if(first_column_end == true && second_column_end == true){
        second_rack_mode = true;
        document.querySelector("#first_rack_element").style.height = "50vh";
        document.querySelector("#second_rack_element").style.height = "50vh";

        document.querySelector(".dsp_btn_second_rack_img").style.backgroundImage = `url(${chrome.runtime.getURL(ui_icon_define.column_single_rack)})`;
    }
    //
    create_profile_list_btn();
    column_dd();
    column_close();
    append_object_css(document.querySelectorAll('#main_rack_element iframe[opd_init_webview]'));
    //プロファイルリスト切替イベント作成関数
    function create_profile_list_btn(){
        //プロファイルリスト切替イベント初期化
        for (let index = 0; index < profile_store.length; index++) {
            document.querySelector(`#userProfile-${index}`).addEventListener("click",function(){
                const preload_desc_array = column_settings.profile_summary(profile_store[index].profile, i18n_message);
                if(confirm(`${i18n_message("msg_profile_load_confirm", [index, preload_desc_array.join("\r\n")])}`)){
                    deck_lifecycle.dispose_column_resources_in(document.querySelector("#opd_main_element"));
                    deck_lifecycle.dispose_all_auto_reload();
                    document.querySelector("#opd_main_element").remove();
                    last_load_profile = index;
                    deck_storage.update_json(deck_storage.KEYS.SETTINGS, {}, function(settings){
                        settings.last_load_profile = index;
                        return settings;
                    });
                    const profile_settings = {column_settings:profile_store[index].profile};
                    run(profile_settings);
                }
            })
        }
    }
    //カラムiframeの初期化。描画直後と追加時に、未初期化(opd_init_webview付き)のiframeだけを渡して呼び出す。
    //iframe単位の load リスナーは lifecycle に登録し、同じiframeへ二重に付けない。
    function append_object_css(column_object){
        if(column_object == null || column_object.length == 0){
            return;
        }

        for (let index = 0; index < column_object.length; index++) {
            const column_frame = column_object[index];
            column_frame.removeAttribute("opd_init_webview");

            //カラム拡張読み込み
            reinit_column_extensions(column_frame.closest("div[opd_column_type]"));

            //バナー/表示モード変更
            const apply_frame_css = function(){
                let opd_column_div = this.closest("div[opd_column_type]");
                let opd_column_banner_checkbox = opd_column_div.querySelector(".opd_banner");
                let opd_column_top_visible_checkbox = opd_column_div.querySelector(".opd_top_bar");
                let opd_column_tw_view_mode_opt = opd_column_div.querySelector(".opd_tw_view_mode");
                const column_type = opd_column_div.getAttribute("opd_column_type");
                const frame_doc = this.contentWindow.document;
                //共通CSS挿入(スクロールバー細くする)
                column_frame_css.apply(frame_doc, "opd_main_css", `html{scrollbar-width:thin;}`);
                //バナー表示ロード
                column_frame_css.apply(frame_doc, "opd_banner_css", column_frame_css.banner_css(opd_column_banner_checkbox?.checked == true));
                //トップ検索欄等削除適用
                column_frame_css.apply(frame_doc, "opd_top_visible_css", column_frame_css.top_visible_css(column_type, opd_column_top_visible_checkbox?.checked == true, true));
                //ツイート表示項目設定読み込み適用
                column_frame_css.apply(frame_doc, "opd_tw_view_mode_css", column_frame_css.view_mode_css(opd_column_tw_view_mode_opt.value));
            };
            column_frame.addEventListener("load", apply_frame_css);
            deck_lifecycle.register_column_resource(column_frame, "frame-css", function(){
                column_frame.removeEventListener("load", apply_frame_css);
            });
            //各カラム読み込み後の動作(init)
            const column_ui_loader = function(){
                let opd_column_div = this.closest("div[opd_column_type]");
                let opd_column_width_btn = opd_column_div.querySelector(".column_width_btn");
                let opd_column_width_select = opd_column_div.querySelector(".opd_column_size_preset");
                let opd_column_banner_checkbox = opd_column_div.querySelector(".opd_banner");
                let opd_column_top_visible_checkbox = opd_column_div.querySelector(".opd_top_bar");
                let opd_column_pinned_checkbox = opd_column_div.querySelector(".opd_pinned_btn");
                let opd_column_auto_reload_checkbox = opd_column_div.querySelector(".opd_a_reload_bar");
                let opd_column_auto_reload_time_reload = opd_column_div.querySelector(".opd_a_reload_time_setting");
                let opd_column_tw_view_mode_opt = opd_column_div.querySelector(".opd_tw_view_mode");
                let opd_column_scroll_to_top = opd_column_div.querySelector(".opd_column_scroll_to_top");
                let opd_column_reload_btn = opd_column_div.querySelector(".opd_column_reload_btn");

                //自動更新と手動更新は複数のイベントハンドラーから呼ぶため、
                //条件分岐の内側ではなくハンドラー直下(関数スコープ)で宣言する
                const auto_reload_target_elem = this;
                //loadのたびに新しいclosureを作るため、前回のintervalをここで確実に止める
                if(typeof auto_reload_target_elem.opd_dispose_auto_reload === "function"){
                    auto_reload_target_elem.opd_dispose_auto_reload();
                }
                let auto_reload_int = null;
                const stop_auto_reload = function(){
                    if(auto_reload_int != null){
                        clearInterval(auto_reload_int);
                        auto_reload_int = null;
                    }
                };
                const dispose_auto_reload = function(){
                    stop_auto_reload();
                    deck_lifecycle.untrack_auto_reload(dispose_auto_reload);
                    if(auto_reload_target_elem.opd_dispose_auto_reload === dispose_auto_reload){
                        delete auto_reload_target_elem.opd_dispose_auto_reload;
                    }
                };
                //Xの更新処理を呼べるカラムはページ遷移せずに最新を取り込む
                const reload_column_content = function(){
                    if(!auto_reload_target_elem.isConnected) return false;
                    try{
                        if(auto_reload_target_elem.opd_auto_reload){
                            auto_reload_target_elem.opd_auto_reload.Reload(auto_reload_target_elem.contentWindow);
                            setTimeout(() => {
                                if(auto_reload_target_elem.isConnected){
                                    auto_reload_target_elem.contentWindow.scrollTo({ top: 0, behavior: 'auto' });
                                }
                            }, 100);
                            return true;
                        }
                        auto_reload_target_elem.contentWindow.location.reload();
                        return true;
                    }catch(err){
                        console.warn("column reload failed->", err);
                        return false;
                    }
                };
                const start_auto_reload = function(interval_ms){
                    stop_auto_reload();
                    if(!Number.isFinite(interval_ms) || interval_ms < 1000){
                        return;
                    }
                    auto_reload_int = setInterval(function(){
                        if(!auto_reload_target_elem.isConnected){
                            dispose_auto_reload();
                            return;
                        }
                        const path_name = auto_reload_target_elem.contentWindow.location.pathname;
                        if(['/home', '/search'].includes(path_name) || path_name.startsWith('/i/lists')){
                            if(auto_reload_target_elem.getAttribute("auto_reload_mouse_hover") != "true"){
                                if (auto_reload_target_elem.opd_auto_reload && is_auto_update()){
                                    reload_column_content();
                                }
                            }
                        }
                    }, interval_ms);
                };

                //手動更新ボタン(カラムごと)
                if(opd_column_reload_btn != null){
                    opd_column_reload_btn.addEventListener("click", function(){
                        const reload_btn_label = this.closest(".dsp_column_btn")?.querySelector(".dsp_column_reload_icon");
                        if(reload_column_content() && reload_btn_label != null){
                            reload_btn_label.setAttribute("opd_reloading", "");
                            setTimeout(() => {
                                reload_btn_label.removeAttribute("opd_reloading");
                            }, 600);
                        }
                    });
                }

                //設定パネルイベント
                opd_column_div.querySelector(".opd_settings_btn").addEventListener("click", function(){
                    const settings_panel = this.closest("div[opd_column_type]").querySelector(".dsp_column_settings_panel");
                    if(settings_panel.getAttribute("open") == null){
                        settings_panel.setAttribute("open", "");
                        settings_panel.style.display = "flex";
                    }else{
                        settings_panel.removeAttribute("open");
                        settings_panel.style.display = "none";
                    }
                });
                opd_column_div.querySelector(".dsp_column_settings_panel_close_btn").addEventListener("click", function(){
                    const settings_panel = this.closest("div[opd_column_type]").querySelector(".dsp_column_settings_panel");
                    settings_panel.removeAttribute("open");
                    settings_panel.style.display = "none";
                })
                //設定パネル&ホバー時動作
                opd_column_div.querySelector(".dsp_column_settings_panel").addEventListener("mouseover", function(){
                    opd_column_div.closest(".dsp_column").setAttribute("draggable", "false");
                });
                opd_column_div.querySelector(".dsp_column_settings_panel").addEventListener("mouseleave", function(){
                    opd_column_div.closest(".dsp_column").setAttribute("draggable", "true");
                });
                //設定パネルカラム幅設定
                if(opd_column_width_select != null){
                    opd_column_width_select.value = column_settings.width_preset_index(opd_column_div.getAttribute("opd_column_width"));
                    opd_column_width_select.addEventListener("change", function(){
                        let preset_rem = column_settings.width_from_preset(this.value);
                        this.closest("div[opd_column_type]").setAttribute("opd_column_width", preset_rem);
                        this.closest("div[opd_column_type]").style.width = `${preset_rem}rem`;
        save_current_profile(last_load_profile);
                    })
                }
                //カラム横幅設定イベント
                opd_column_width_btn.addEventListener("click", function(){
                    const now_width = this.closest("div[opd_column_type]").getAttribute("opd_column_width");
                    let column_width_preset  = this.closest("div[opd_column_type]").querySelector(".opd_column_size_preset");
                    let setting_width = prompt(i18n_message("msg_column_width_prompt"), now_width);
                    if(setting_width != null){
                        const setting_width_num = Number(setting_width);
                        if(!Number.isNaN(setting_width_num) && setting_width_num > 11){
                            this.closest("div[opd_column_type]").setAttribute("opd_column_width", setting_width_num);
                            this.closest("div[opd_column_type]").style.width = `${setting_width_num}rem`;
        save_current_profile(last_load_profile);
                            column_width_preset.value = column_settings.width_preset_index(setting_width_num);
                        }else{
                            alert(i18n_message("msg_invalid_value_alert"));
                        }
                    }
                });

                const column_type = opd_column_div.getAttribute("opd_column_type");
                const frame_doc = this.contentWindow.document;
                //バナー表示設定読み込み適用
                column_frame_css.apply(frame_doc, "opd_banner_css", column_frame_css.banner_css(opd_column_banner_checkbox?.checked == true));
                //トップ検索欄等削除適用
                column_frame_css.apply(frame_doc, "opd_top_visible_css", column_frame_css.top_visible_css(column_type, opd_column_top_visible_checkbox?.checked == true));
                //ツイート表示項目設定読み込み適用
                opd_column_tw_view_mode_opt.value = opd_column_tw_view_mode_opt.getAttribute("column_tw_view_mode_val")
                column_frame_css.apply(frame_doc, "opd_tw_view_mode_css", column_frame_css.view_mode_css(opd_column_tw_view_mode_opt.getAttribute("column_tw_view_mode_val")));
                //自動更新初期適用
                if(opd_column_auto_reload_checkbox != null){
                    auto_reload_target_elem.opd_dispose_auto_reload = dispose_auto_reload;
                    deck_lifecycle.track_auto_reload(dispose_auto_reload);
                    //Home, Exproleカラムホバー中 自動更新上部遷移停止
                    opd_column_div.querySelector("iframe").addEventListener("mouseover", function(){
                        this.setAttribute("auto_reload_mouse_hover", "true");
                    });
                    opd_column_div.querySelector("iframe").addEventListener("mouseleave", function(){
                        this.setAttribute("auto_reload_mouse_hover", "false");
                    });
                    opd_column_auto_reload_time_reload.addEventListener("change", function(){
                        const auto_reload_time = auto_reload_target_elem.closest('div[opd_column_type]').querySelector(".opd_a_reload_time_setting");
                        if(Number(auto_reload_time.value) >= 1){
                            alert(i18n_message("msg_auto_reload_set", [auto_reload_time.value]));
                            if(opd_column_auto_reload_checkbox.checked){
                                start_auto_reload(Number(auto_reload_time.value) * 1000);
                            }
        save_current_profile(last_load_profile);
                        }else{
                            alert(i18n_message("msg_auto_reload_minimum_alert"));
                            auto_reload_time.value = '10';
                            if(opd_column_auto_reload_checkbox.checked){
                                start_auto_reload(10000);
                            }
        save_current_profile(last_load_profile);
                        }
                    });
                    //初期チェック動作
                    if(opd_column_auto_reload_checkbox.checked){
                        const auto_reload_time_input = auto_reload_target_elem.closest('div[opd_column_type]').querySelector(".opd_a_reload_time_setting");
                        const auto_reload_load_time = Number(auto_reload_time_input.value) * 1000;
                        auto_reload_time_input.disabled = true;
                        start_auto_reload(auto_reload_load_time);
                    }
                }

                //バナーチェックイベント
                opd_column_banner_checkbox?.addEventListener("change", function(){
        save_current_profile(last_load_profile);
                    let banner_mode_target_object = this.closest("div[opd_column_type]").querySelector("iframe");
                    column_frame_css.apply(banner_mode_target_object.contentWindow.document, "opd_banner_css", column_frame_css.banner_css(this.checked == true));
                });

                //トップ検索欄等削除イベント
                opd_column_top_visible_checkbox?.addEventListener("change", function(){
        save_current_profile(last_load_profile);
                    let topvisible_mode_target_object = this.closest("div[opd_column_type]").querySelector("iframe");
                    const column_type = this.closest("div[opd_column_type]").getAttribute("opd_column_type");
                    column_frame_css.apply(topvisible_mode_target_object.contentWindow.document, "opd_top_visible_css", column_frame_css.top_visible_css(column_type, this.checked == true));
                });

                //Exproleピン止め
                if(opd_column_pinned_checkbox != null){
                    opd_column_pinned_checkbox.addEventListener("click", function(){
                        if(this.checked){
                            if(confirm(i18n_message("msg_explore_pin_confirm"))){
                                const now_path = this.closest("div[opd_column_type]").getAttribute("opd_explore_path");
                                this.closest("div[opd_column_type]").setAttribute("opd_pinned_path",now_path);
        save_current_profile(last_load_profile);
                            }else{
                                this.checked = false;
                            }
                        }else{
                            if(confirm(i18n_message("msg_explore_unpin_confirm"))){
                                this.closest("div[opd_column_type]").setAttribute("opd_pinned_path","");
        save_current_profile(last_load_profile);
                                this.checked = false;
                            }else{
                                this.checked = true;
                            }
                        }
                    });
                }
                //自動更新モードイベント
                if(opd_column_auto_reload_checkbox != null){
                    opd_column_auto_reload_checkbox.addEventListener("click", function(){
                        const auto_reload_time_input = this.closest("div[opd_column_type]").querySelector(".opd_a_reload_time_setting");
                        const auto_reload_time = Number(auto_reload_time_input.value) * 1000;
                        if(this.checked){
                            auto_reload_time_input.disabled = true;
                            start_auto_reload(auto_reload_time);
        save_current_profile(last_load_profile);
                        }else{
                            auto_reload_time_input.disabled = false;
                            stop_auto_reload();
        save_current_profile(last_load_profile);
                        }
                    });
                }
                //ツイート表示モードイベント
                opd_column_tw_view_mode_opt.addEventListener("change", function(){
        save_current_profile(last_load_profile);
                    let tw_view_mode_target_object = this.closest("div[opd_column_type]").querySelector("iframe");
                    column_frame_css.apply(tw_view_mode_target_object.contentWindow.document, "opd_tw_view_mode_css", column_frame_css.view_mode_css(this.value));
                })

                //カラムバー空白領域クリックでトップにスクロール
                opd_column_scroll_to_top.addEventListener("click", (e) => { this.contentWindow.scrollTo({ top: 0, behavior: "auto" }); });

            };
            column_frame.addEventListener("load", column_ui_loader, {once: true});
            deck_lifecycle.register_column_resource(column_frame, "frame-init", function(){
                column_frame.removeEventListener("load", column_ui_loader);
            });
            //exploreURL検出処理
            const opd_column_mutate = column_frame.closest("div[opd_column_type]");
            if(opd_column_mutate.getAttribute("opd_column_type") == 'explore'){
                mutate_url(opd_column_mutate);
            }
        }
    }
    //URL, ページタイトル監視
    function mutate_url(element){
        const exp_object = element.querySelector("iframe");
        const read_explore_state = function(){
            try{
                const href = exp_object.contentWindow.location.href;
                const url = new URL(href);
                return {
                    href: href,
                    path: `${url.pathname}${url.search}`,
                    title: exp_object.contentWindow.document.title,
                    document: exp_object.contentWindow.document,
                };
            }catch(error){
                //外部オリジンや遷移途中は読めないため、次回loadへ委ねる
                return null;
            }
        };
        const dispose_url_observer = function(){
            if(exp_object.opd_url_observer != null){
                exp_object.opd_url_observer.disconnect();
                delete exp_object.opd_url_observer;
            }
        };
        const on_explore_load = function(){
            dispose_url_observer();
            const initial_state = read_explore_state();
            if(initial_state == null){
                return;
            }
            //XはSPA遷移でURLを先に変え、document.titleをその後で書き換える。
            //同じ通知でURLとタイトルを一緒に読むと、タイトルだけ1ページ前のまま保存される。
            //URLとタイトルは別々に比べ、変わった項目だけを書き戻す。
            let exp_old_url = initial_state.href;
            let exp_old_title = element.getAttribute("opd_explore_title") ?? "";
            const exp_observer = new MutationObserver(function(){
                const current_state = read_explore_state();
                if(current_state == null){
                    return;
                }
                const changes = column_settings.explore_state_changes(
                    {href: exp_old_url, title: exp_old_title},
                    current_state
                );
                if(changes.column_save_path != undefined){
                    exp_old_url = current_state.href;
                    element.setAttribute("opd_explore_path", changes.column_save_path);
                }
                if(changes.column_save_title != undefined){
                    exp_old_title = changes.column_save_title;
                    element.setAttribute("opd_explore_title", changes.column_save_title);
                }
                if(changes.column_save_path == undefined && changes.column_save_title == undefined){
                    return;
                }
        save_current_profile(last_load_profile);
            });
            exp_object.opd_url_observer = exp_observer;
            exp_observer.observe(initial_state.document, {childList: true, subtree: true});
        };
        exp_object.addEventListener("load", on_explore_load);
        deck_lifecycle.register_column_resource(exp_object, "explore-url", function(){
            exp_object.removeEventListener("load", on_explore_load);
            dispose_url_observer();
        });
    }
    //メインバーイベント
    document.getElementById("init_settings").addEventListener("click", function(){
        deck_storage.remove(deck_storage.KEYS.SETTINGS, function(){
            alert(i18n_message("msg_settings_reset_completed"));
        });
    });
    //画像付きを開いた時の自動スクロール阻止
    document.querySelector("#main_rack_element").addEventListener("scrollend", function(){
        document.querySelector("#main_rack_element").scrollTop = 0;
    })
    //二段表示
    document.getElementById("second_rack").addEventListener("click", function(){
        if(second_rack_mode == false){
            document.querySelector("#first_rack_element").style.height = "50vh";
            document.querySelector("#second_rack_element").style.height = "50vh";
            const second_rack_default_html = column_settings.render(
                default_element.second_empty_column.html,
                column_settings.new_column_setting("second_empty_column"),
                create_random_id()
            );
            document.querySelector("#second_rack_element").insertAdjacentHTML("beforeend", second_rack_default_html);
            column_dd();
            column_close();
            save_current_profile(last_load_profile);
            second_rack_mode = true;
            document.querySelector(".dsp_btn_second_rack_img").style.backgroundImage = `url(${chrome.runtime.getURL(ui_icon_define.column_single_rack)})`;
        }else{
            if(confirm(i18n_message("msg_second_rack_to_single_confirm"))){
                const timeline_before = snapshot_timeline_state();
                deck_lifecycle.dispose_column_resources_in(document.querySelector("#second_rack_element"));
                document.querySelector("#second_rack_element").textContent = "";
                remap_timeline_state(timeline_before);
                document.querySelector("#first_rack_element").style.height = "100vh";
                document.querySelector("#second_rack_element").style.height = "0";
                document.querySelector("#second_rack_element").style.height = "0";
                save_current_profile(last_load_profile);
                second_rack_mode = false;
                document.querySelector(".dsp_btn_second_rack_img").style.backgroundImage = `url(${chrome.runtime.getURL(ui_icon_define.column_second_rack)})`;
            }
        }
        
    });
    //プロファイルローダー
    document.getElementById("profile_load_save").addEventListener("click", function(){
        window.open(chrome.runtime.getURL("profile_debug.html"), "OPD-Profile-Loader", 'width=720, height=600');
    });
    //
    document.getElementById("dnr_reload").addEventListener("click", function(){
        if(confirm(i18n_message("msg_dnr_reload_confirm"))){
            chrome.runtime.sendMessage({message: "dnr_upd"}).then((value)=>{
                if(value == true){
                    location.reload();
                }
            });
        }
    });
    document.getElementById("ext_reload").addEventListener("click", function(){
        if(confirm(i18n_message("msg_extension_reload_confirm"))){
            chrome.runtime.sendMessage({message: "ext_reload"});
        }
    });
    //Shiftを押しながらの追加は先頭へ入れる。押下状態はクリックイベントから直接読む。
    function add_new_column(type, is_shift_pressed){
        return column_dom.add_column(
            document,
            type,
            default_element[type].html,
            column_settings,
            create_random_id,
            window.opd_custom_column_reorder,
            is_shift_pressed
        );
    }

    //カラム型ごとの差はここに閉じ込め、追加後の初期化・再接続・保存は必ず同じ経路を通す。
    const column_add_buttons = [
        {id: "add_post", type: "post", remap_timeline: false},
        {id: "add_timeline", type: "home", remap_timeline: true},
        {id: "add_notify", type: "notification", remap_timeline: false},
        {id: "add_explore", type: "explore", remap_timeline: false},
    ];

    function finalize_added_column(new_column_element, timeline_before){
        if(timeline_before != null){
            remap_timeline_state(timeline_before);
        }
        new_column_element?.scrollIntoView({behavior: "smooth",inline: "end"});
        const all_webview = document.querySelectorAll('#main_rack_element iframe[opd_init_webview]');
        append_object_css(all_webview);
        column_dd();
        column_close();
        save_current_profile(last_load_profile);
    }

    column_add_buttons.forEach(function(config){
        document.getElementById(config.id).addEventListener("click", function(event){
            const timeline_before = config.remap_timeline ? snapshot_timeline_state() : null;
            const new_column_element = add_new_column(config.type, event.shiftKey);
            finalize_added_column(new_column_element, timeline_before);
        });
    });
    //プロファイル保存ボタン
    document.getElementById("profile_save").addEventListener("click", function(){
        if(confirm(i18n_message("msg_profile_save_confirm"))){
            let profile = read_current_profile();
            //複製したカラムは複製元と同じ安定IDを持つため、保存前に振り直す。
            //uid_map は複製元のIDから新しいIDへの対応で、タブ保存の複製に使う
            const copied = column_settings.reissue_uids(profile.column_settings, create_random_id);
            const save_object = {name:"user_profile", profile:copied.profile};
            profile_store.push(save_object);
            const new_profile_index = profile_store.length - 1;
            deck_storage.set_json(deck_storage.KEYS.PROFILE_STORE, profile_store, function () {
                copy_profile_tab_state(last_load_profile, new_profile_index, copied.uid_map);
                refresh_profile_list();
            });
        }
    });
    //プロファイル削除ボタン
    document.getElementById("profile_delete").addEventListener("click", function(){
        const delete_input = prompt(i18n_message("msg_profile_delete_number_prompt"));
        if(delete_input == null){
            return;
        }
        const normalized_delete_input = delete_input.trim();
        if(!/^\d+$/.test(normalized_delete_input)){
            alert(i18n_message("msg_invalid_value_alert"));
            return;
        }
        const delete_num = Number(normalized_delete_input);
        if(!Number.isSafeInteger(delete_num) || delete_num < 0 || delete_num >= profile_store.length){
            alert(i18n_message("msg_invalid_value_alert"));
            return;
        }
        if(last_load_profile != delete_num){
            if(confirm(i18n_message("msg_profile_delete_confirm", [delete_num]))){
                profile_store.splice(delete_num, 1);
                //一覧を詰めたのと同じ同期区間で現在番号と表示を補正する。保存完了を待つと、
                //その間の自動保存が詰めた後の配列を補正前の番号で書き換える
                const after_profile_num = last_load_profile < delete_num ? last_load_profile : Math.max(last_load_profile - 1, 0);
                last_load_profile = after_profile_num;
                refresh_profile_list(after_profile_num);
                //タブ状態の番号の詰め直しを、補正後の番号でのタブ保存より先に書き込みキューへ積む
                delete_profile_tab_state(delete_num);
                deck_storage.set_json(deck_storage.KEYS.PROFILE_STORE, profile_store, function () {
                    deck_storage.update_json(deck_storage.KEYS.SETTINGS, {}, function(settings){
                        settings.last_load_profile = after_profile_num;
                        return settings;
                    }, function(){});
                });
            }
        }else{
            alert(i18n_message("msg_profile_delete_current_alert"));
        }
    });
    //対象型と初期化手順を同じ定義に置き、追加時の分岐漏れを防ぐ。
    const column_extension_registry = [
        {
            types: null,
            init(column_frame){
                const opd_utils = new OpdUtils();
                opd_utils.Init(column_frame);
            },
        },
        {
            types: ["post"],
            init(column_frame){
                const ext_text_review = new OpdExtTextReview();
                const ui_lang = chrome.i18n.getUILanguage();
                ext_text_review.Init(column_frame, ui_icon_define, ui_lang);
            },
        },
        {
            types: ["home", "explore"],
            init(column_frame){
                const auto_reload = new OpdExtAutoReload();
                auto_reload.Init(column_frame);
                column_frame.opd_auto_reload = auto_reload;

                const blocker = new OpdMediaViewerBlocker();
                blocker.Init(column_frame);
                //同じiframeの再読込では最新tokenへ置き換え、削除済みiframeはWeakMapに保持させない
                deck_lifecycle.register_media_viewer_token(column_frame, blocker.opd_send_media_info_token);
            },
        },
    ];

    //カラム拡張機能の初期化(カラム拡張機能の追加はregistryで行います)
    function reinit_column_extensions(column_div){
        const column_frame = column_div?.querySelector("iframe");
        if(!column_frame) return;
        const column_type = column_div.getAttribute("opd_column_type");

        const ext_load = () => {
            column_extension_registry.forEach(function(extension){
                if(extension.types == null || extension.types.includes(column_type)){
                    extension.init(column_frame);
                }
            });
        };

        //拡張が追加済なら追加しない
        if(column_frame.opd_extension_loader_added) return;
        column_frame.opd_extension_loader_added = true;

        //拡張を追加する
        column_frame.addEventListener("load", ext_load);
    }

    function snapshot_timeline_state(){
        const reorder_api = window.opd_custom_column_reorder;
        if(reorder_api == undefined || reorder_api.snapshot_timeline_sections == undefined){
            return null;
        }
        return reorder_api.snapshot_timeline_sections(document);
    }

    function remap_timeline_state(before_sections){
        const reorder_api = window.opd_custom_column_reorder;
        if(before_sections == null || reorder_api == undefined || reorder_api.remap_after_dom_change == undefined){
            return;
        }
        reorder_api.remap_after_dom_change(before_sections, document);
    }

    function copy_profile_tab_state(source_profile_index, target_profile_index, uid_map){
        const state_api = window.opd_custom_column_state;
        if(state_api != undefined && state_api.copy_profile != undefined){
            state_api.copy_profile(source_profile_index, target_profile_index, uid_map);
        }
    }

    function delete_profile_tab_state(deleted_profile_index){
        const state_api = window.opd_custom_column_state;
        if(state_api != undefined && state_api.delete_profile != undefined){
            state_api.delete_profile(deleted_profile_index);
        }
    }

    //カラム移動
    function column_dd(){
        let column_class = document.querySelectorAll(".dsp_column");
        let column_copy_source = null;
        for (let index = 0; index < column_class.length; index++) {
            //既にイベントが登録済みのカラムはスキップ
            if(column_class[index].dataset.opd_dd_initialized === "1") continue;
            column_class[index].dataset.opd_dd_initialized = "1";
        
            column_class[index].addEventListener("dragstart", function(ev){
                column_copy_source = this;
                ev.dataTransfer.setData('text/plain', ev.target.id);
            });
            column_class[index].addEventListener("dragover", function(ev){
                ev.preventDefault();
                this.style.borderLeft = '15px solid #2e2e2e';
            });
            column_class[index].addEventListener("dragleave", function(){
                this.style.borderLeft = '';
            });
            column_class[index].addEventListener("drop", function(ev){
                ev.preventDefault();
                const dt_id = ev.dataTransfer.getData('text/plain');
                const dr_elem = document.getElementById(dt_id);
                if(dr_elem != null){
                    const timeline_before = ev.opd_custom_tab_remap === true ? null : snapshot_timeline_state();
                    const reorder_api = window.opd_custom_column_reorder;
                    //段をまたぐ移動もmove_beforeがDOM移動とorderの振り直しまで行う
                    const moved = reorder_api?.move_before?.(dr_elem, this) === true;
                    if(!moved){
                        this.parentNode.insertBefore(dr_elem, this);
                    }
                    remap_timeline_state(timeline_before);
                    this.style.borderLeft = '';
        save_current_profile(last_load_profile);
                }else{
                    this.style.borderLeft = '';
                }
            })
        }
    }
    //カラム終了
    function column_close(){
        const close_btns = document.querySelectorAll(".column_close_btn");
        for (let index = 0; index < close_btns.length; index++) {
            //既にイベントが登録済みのカラムはスキップ
            if(close_btns[index].dataset.opd_close_initialized === "1") continue;
                close_btns[index].dataset.opd_close_initialized = "1";
                close_btns[index].addEventListener("click", function(){
                const pin_checkbox = this.closest(".dsp_column").querySelector(".opd_pinned_btn")?.checked;
                if(pin_checkbox == false || pin_checkbox == undefined){
                    const timeline_before = snapshot_timeline_state();
                    const column = this.closest(".dsp_column");
                    column_dom.dispose_and_remove(column, deck_lifecycle);
                    remap_timeline_state(timeline_before);
        save_current_profile(last_load_profile);
                }else{
                    if(confirm(i18n_message("msg_pinned_column_close_confirm"))){
                        const timeline_before = snapshot_timeline_state();
                        const column = this.closest(".dsp_column");
                        column_dom.dispose_and_remove(column, deck_lifecycle);
                        remap_timeline_state(timeline_before);
        save_current_profile(last_load_profile);
                    }
                }
            })
        }
    }
    //自動更新許可を取得する関数
    function is_auto_update(){
        //テキスト入力フォーカス中
        if(column_auto_update_state.text_focus.active){
            return false;
        }
        //メディアビューワー表示中
        if(column_auto_update_state.media_viewer.active){
            return false;
        }
        return true;
    }
}
//現在表示中のカラム構成を読み取る。読み取り専用の呼び出しは保存経路を通さない。
function read_current_profile(){
    return {
        column_settings: column_settings.read_profile(
            document,
            window.opd_custom_column_reorder
        ),
        version: manifest.version
    };
}
//現在のプロファイルへカラム構成を保存する。
function save_current_profile(profile_num){
    //存在しない番号へ書くと例外になり、ずれた番号なら別のプロファイルを上書きする
    if(profile_store?.[profile_num] == null){
        console.error("Open-Deck profile could not be saved: unknown profile", profile_num);
        return;
    }
    const settings_array = read_current_profile();
    const save_object = {name:"user_profile", profile:settings_array.column_settings};
    Object.assign(profile_store[profile_num], save_object);
    deck_storage.set_json(deck_storage.KEYS.PROFILE_STORE, profile_store, function () {
    });
}
//独自の左右・表示順コントロールはDOMを差し替えずstyle.orderだけを変える。
//並び替え完了通知を本家の保存境界へ接続する。run() 内で登録するとプロファイル切替の
//たびにリスナーが増え、並び替え1回で保存が切替回数ぶん走るため、ここで1回だけ登録する。
document.addEventListener("opd_custom_column_reordered", function(){
    save_current_profile(last_load_profile);
});

//カラー・CSS周りを設定する
function head_observer_callback(head_elem){
    //デフォルトのCSSがUIに影響を与えないように削除する
    if(!is_removed_default_style){
        head_elem.querySelectorAll('style').forEach(style => {
            if(style.textContent.includes('*, ::before, ::after')){
                style.remove();
                is_removed_default_style = true;
            }
        });
    }

    //ダークモード検出&設定
    const color_scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const main_element = document.getElementById("opd_main_element");
    if(!main_element) return;

    const color_mode = get_cookie_color_mode();
    switch (color_mode){
        case "system": {
            if(!is_added_system_color_mode){
                system_color_scheme = color_scheme;
                apply_ui_color = () => {
                    const current_main_element = document.getElementById("opd_main_element");
                    if(current_main_element == null || system_color_scheme == null) return;
                    const current_scheme = system_color_scheme.matches ? "dark" : "light";
                    current_main_element.setAttribute("opd-dsp-theme", current_scheme);
                };
                system_color_scheme.addEventListener("change", apply_ui_color);
                is_added_system_color_mode = true;
            }
            apply_ui_color();
            break;
        }
        case "light":
            if(is_added_system_color_mode && apply_ui_color && system_color_scheme){
                system_color_scheme.removeEventListener("change", apply_ui_color);
                is_added_system_color_mode = false;
                system_color_scheme = null;
            }
            main_element.setAttribute("opd-dsp-theme", "light");
            break;
        case "dark":
            if(is_added_system_color_mode && apply_ui_color && system_color_scheme){
                system_color_scheme.removeEventListener("change", apply_ui_color);
                is_added_system_color_mode = false;
                system_color_scheme = null;
            }
            main_element.setAttribute("opd-dsp-theme", "dark");
            break;
        default:
            break;
    }
}

//メインX動作マスク
function main_dsp(react_root){
    if(!react_root) return;
    react_root.style.visibility = "hidden";
    react_root.style.overflow = "hidden";
}

//Cookieからカラーモードを取得する
function get_cookie_color_mode() {
    const cookie = document.cookie.split(/;\s*/).find(c => c.startsWith('night_mode='));

    //night_mode が存在しない場合は system を返す
    if(!cookie) return "system";

    const color_mode_number = Number(cookie.split('=')[1]);

    // 数値として正常でない場合は system を返す
    if(!Number.isInteger(color_mode_number)) return "system";

    //カラーモードが 0 以下の場合は light を返す
    if(color_mode_number <= 0) return "light";

    //カラーモードが 1 以上の場合は dark を返す
    return "dark";
}
//設定初期化
function settings_init(){
    const profile_store_default = column_settings.default_profile();
    const settings = {
        last_load_profile:0,
        version:manifest.version
    };
    let profile = [{name:"default", profile: profile_store_default}];
    const initial_storage = {};
    initial_storage[deck_storage.KEYS.PROFILE_STORE] = profile;
    initial_storage[deck_storage.KEYS.SETTINGS] = settings;
    deck_storage.set_json_many(initial_storage, function(error){
        if(error == null){
            if(is_prototype){
                alert(i18n_message("msg_initial_setup_completed_prototype"));
            }else{
                alert(i18n_message("msg_initial_setup_completed"));
            }
            location.reload();
        }else{
            console.error("Open-Deck initial settings could not be saved.", error);
        }
    });
}
