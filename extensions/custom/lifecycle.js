//3つのライフサイクル責務(カラム資源・ページイベント・ページobserver)をまとめる合成点。
//実装は column_resource_registry.js / page_event_lifecycle.js / page_observer_lifecycle.js にあり、
//ここは呼び出し側(content.js・index.js・text_review.js)向けの入口だけを持つ。
window.opd_custom_lifecycle = (function(){
    const column_resources = window.opd_custom_column_resource_registry;
    const page_events = window.opd_custom_page_event_lifecycle;
    const page_observers = window.opd_custom_page_observer_lifecycle;

    function initialize_page_event_listeners(options){
        return page_events.initialize({
            on_post_focus: options.on_post_focus,
            on_media_info: options.on_media_info,
            is_current_media_viewer_token: column_resources.is_current_media_viewer_token,
        });
    }

    return {
        dispose_all_auto_reload: column_resources.dispose_all_auto_reload,
        dispose_auto_reload_in: column_resources.dispose_auto_reload_in,
        dispose_column_resources_in: column_resources.dispose_column_resources_in,
        initialize_page_event_listeners,
        initialize_page_observers: page_observers.initialize_page_observers,
        initialize_title_favicon: page_observers.initialize_title_favicon,
        is_current_media_viewer_token: column_resources.is_current_media_viewer_token,
        register_media_viewer_token: column_resources.register_media_viewer_token,
        register_column_resource: column_resources.register_column_resource,
        track_auto_reload: column_resources.track_auto_reload,
        untrack_auto_reload: column_resources.untrack_auto_reload,
    };
})();
