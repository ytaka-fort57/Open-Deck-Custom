//カラム(iframe)ごとの後始末だけを持つ。自動更新の disposer、カラム資源の disposer、
//メディアビューアの token を iframe に紐付け、カラムの破棄時にまとめて解放する。
window.opd_custom_column_resource_registry = (function(){
    const auto_reload_disposers = new Set();
    const media_viewer_tokens_by_frame = new WeakMap();
    const column_resources_by_frame = new WeakMap();

    function track_auto_reload(dispose){
        auto_reload_disposers.add(dispose);
    }

    function untrack_auto_reload(dispose){
        auto_reload_disposers.delete(dispose);
    }

    function dispose_all_auto_reload(){
        Array.from(auto_reload_disposers).forEach(function(dispose){
            dispose();
        });
    }

    function dispose_auto_reload_in(root){
        if(root == null){
            return;
        }
        root.querySelectorAll("iframe").forEach(function(iframe){
            if(typeof iframe.opd_dispose_auto_reload === "function"){
                iframe.opd_dispose_auto_reload();
            }
        });
    }

    function register_column_resource(frame, key, dispose){
        if(frame == null || typeof dispose !== "function"){
            return;
        }
        let resources = column_resources_by_frame.get(frame);
        if(resources == null){
            resources = new Map();
            column_resources_by_frame.set(frame, resources);
        }
        const previous = resources.get(key);
        if(typeof previous === "function"){
            previous();
        }
        resources.set(key, dispose);
    }

    function dispose_column_frame(frame){
        const resources = column_resources_by_frame.get(frame);
        column_resources_by_frame.delete(frame);
        if(resources != null){
            Array.from(resources.values()).forEach(function(dispose){
                dispose();
            });
        }
        if(typeof frame?.opd_dispose_auto_reload === "function"){
            frame.opd_dispose_auto_reload();
        }
    }

    function dispose_column_resources_in(root){
        if(root == null){
            return;
        }
        const frames = [];
        if(root.tagName === "IFRAME"){
            frames.push(root);
        }
        root.querySelectorAll?.("iframe").forEach(function(frame){
            frames.push(frame);
        });
        frames.forEach(dispose_column_frame);
    }

    function register_media_viewer_token(frame, token){
        media_viewer_tokens_by_frame.set(frame, token);
    }

    function is_current_media_viewer_token(token, frames){
        return Array.from(frames).some(function(frame){
            return media_viewer_tokens_by_frame.get(frame) === token;
        });
    }

    return {
        dispose_all_auto_reload,
        dispose_auto_reload_in,
        dispose_column_resources_in,
        is_current_media_viewer_token,
        register_column_resource,
        register_media_viewer_token,
        track_auto_reload,
        untrack_auto_reload,
    };
})();
