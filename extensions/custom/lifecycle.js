window.opd_custom_lifecycle = (function(){
    const auto_reload_disposers = new Set();
    const media_viewer_tokens_by_frame = new WeakMap();
    let is_page_event_listener_initialized = false;
    let is_page_observer_initialized = false;
    let is_title_favicon_initialized = false;

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

    function register_media_viewer_token(frame, token){
        media_viewer_tokens_by_frame.set(frame, token);
    }

    function is_current_media_viewer_token(token, frames){
        return Array.from(frames).some(function(frame){
            return media_viewer_tokens_by_frame.get(frame) === token;
        });
    }

    function parse_event_detail(raw_detail){
        try{
            return JSON.parse(raw_detail);
        }catch(error){
            console.warn("Open-Deck ignored an invalid custom event payload.", error);
            return undefined;
        }
    }

    function initialize_page_event_listeners(options){
        if(is_page_event_listener_initialized){
            return;
        }
        is_page_event_listener_initialized = true;

        window.addEventListener("opd_post_focus", function(event){
            const detail = parse_event_detail(event.detail);
            if(detail !== undefined){
                options.on_post_focus(detail);
            }
        });

        document.addEventListener("opd_send_media_info", function(event){
            const detail = parse_event_detail(event.detail);
            if(detail === undefined){
                return;
            }
            const current_frames = document.querySelectorAll("#main_rack_element iframe");
            if(is_current_media_viewer_token(detail.token, current_frames)){
                options.on_media_info(detail);
            }
        });
    }

    function observe_when_ready(get_target, watch_root, observer_callback, observer_options){
        const target = get_target();
        if(target){
            observer_callback(target);
            new MutationObserver(function(){
                observer_callback(target);
            }).observe(target, observer_options);
            return;
        }

        if(!watch_root){
            return;
        }

        const wait_observer = new MutationObserver(function(){
            const target_retry = get_target();
            if(target_retry){
                wait_observer.disconnect();
                observer_callback(target_retry);
                new MutationObserver(function(){
                    observer_callback(target_retry);
                }).observe(target_retry, observer_options);
            }
        });
        wait_observer.observe(watch_root, {childList: true});
    }

    function initialize_page_observers(options){
        if(!is_page_observer_initialized){
            is_page_observer_initialized = true;
            observe_when_ready(
                options.get_react_root,
                options.react_watch_root,
                options.on_react_change,
                options.react_observer_options
            );
            observe_when_ready(
                options.get_head,
                options.head_watch_root,
                options.on_head_change,
                options.head_observer_options
            );
            return;
        }

        options.on_react_change(options.get_react_root());
        const head = options.get_head();
        if(head){
            options.on_head_change(head);
        }
    }

    function initialize_title_favicon(title, favicon_url){
        if(is_title_favicon_initialized){
            return;
        }
        is_title_favicon_initialized = true;

        document.head.querySelectorAll("title").forEach(function(element){
            if(element.dataset.opd !== "1"){
                element.remove();
            }
        });
        let opd_title = document.head.querySelector('title[data-opd="1"]');
        if(!opd_title){
            opd_title = document.createElement("title");
            opd_title.dataset.opd = "1";
            opd_title.textContent = title;
            document.head.appendChild(opd_title);
        }

        const title_observer = new MutationObserver(function(){
            if(opd_title.textContent !== title){
                opd_title.textContent = title;
            }
            document.head.querySelectorAll("title").forEach(function(element){
                if(element.dataset.opd !== "1"){
                    element.remove();
                }
            });
        });
        title_observer.observe(opd_title, {
            childList: true,
            characterData: true,
            subtree: true,
        });

        const head_title_observer = new MutationObserver(function(mutations){
            for(const mutation of mutations){
                for(const node of mutation.addedNodes){
                    if(node.tagName === "TITLE" && node.dataset.opd !== "1"){
                        node.remove();
                    }
                }
            }
        });
        head_title_observer.observe(document.head, {childList: true});

        document.head.querySelectorAll('link[rel="shortcut icon"], link[rel="icon"]').forEach(function(element){
            if(element.dataset.opd !== "1"){
                element.remove();
            }
        });
        let opd_favicon = document.head.querySelector('link[data-opd="1"]');
        if(!opd_favicon){
            opd_favicon = document.createElement("link");
            opd_favicon.rel = "shortcut icon";
            opd_favicon.href = favicon_url;
            opd_favicon.dataset.opd = "1";
            document.head.appendChild(opd_favicon);
        }

        const favicon_observer = new MutationObserver(function(){
            if(opd_favicon.getAttribute("href") !== favicon_url){
                opd_favicon.setAttribute("href", favicon_url);
            }
        });
        favicon_observer.observe(opd_favicon, {
            attributes: true,
            attributeFilter: ["href", "rel"],
        });

        const head_favicon_observer = new MutationObserver(function(mutations){
            for(const mutation of mutations){
                for(const node of mutation.addedNodes){
                    if(node.tagName === "LINK"
                        && (node.rel === "shortcut icon" || node.rel === "icon")
                        && node.dataset.opd !== "1"){
                        node.remove();
                    }
                }
            }
        });
        head_favicon_observer.observe(document.head, {childList: true});
    }

    return {
        dispose_all_auto_reload,
        dispose_auto_reload_in,
        initialize_page_event_listeners,
        initialize_page_observers,
        initialize_title_favicon,
        is_current_media_viewer_token,
        register_media_viewer_token,
        track_auto_reload,
        untrack_auto_reload,
    };
})();
