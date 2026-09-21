//ページ全体へ1度だけ張る CustomEvent リスナーを持つ。
//helper 側から送られる JSON 文字列の検査と、期限切れ token の破棄もここで行う。
window.opd_custom_page_event_lifecycle = (function(){
    let dispose_listeners = null;

    function parse_event_detail(raw_detail){
        try{
            return JSON.parse(raw_detail);
        }catch(error){
            console.warn("Open-Deck ignored an invalid custom event payload.", error);
            return undefined;
        }
    }

    //戻り値は disposer。2度目以降の呼び出しでは最初に張ったリスナーの disposer を返す。
    function initialize(options){
        if(dispose_listeners != null){
            return dispose_listeners;
        }

        const on_post_focus = function(event){
            const detail = parse_event_detail(event.detail);
            if(detail !== undefined){
                options.on_post_focus(detail);
            }
        };

        const on_send_media_info = function(event){
            const detail = parse_event_detail(event.detail);
            if(detail === undefined){
                return;
            }
            const current_frames = document.querySelectorAll("#main_rack_element iframe");
            if(options.is_current_media_viewer_token(detail.token, current_frames)){
                options.on_media_info(detail);
            }
        };

        window.addEventListener("opd_post_focus", on_post_focus);
        document.addEventListener("opd_send_media_info", on_send_media_info);

        dispose_listeners = function(){
            window.removeEventListener("opd_post_focus", on_post_focus);
            document.removeEventListener("opd_send_media_info", on_send_media_info);
            dispose_listeners = null;
        };
        return dispose_listeners;
    }

    return {
        initialize,
        parse_event_detail,
    };
})();
