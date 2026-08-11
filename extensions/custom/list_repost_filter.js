//リスト内で、同一作者のリポストと有料パートナーシップ投稿を非表示にする
window.opd_custom_list_repost_filter = (function(){
    const HIDDEN_CLASS = "opd_custom_same_author_repost";
    const STYLE_ATTR = "opd_custom_same_author_repost_css";
    const FRAME_ATTR = "opd_custom_list_repost_filter_attached";
    const RESOURCE_KEY = "list-repost-filter";
    const LIST_PATH_RE = /^\/i\/lists\/[^/]+\/?$/i;
    const HOME_NON_LIST_TAB_LABELS = new Set([
        "おすすめ", "フォロー中", "for you", "following"
    ]);
    const EXCLUDED_PROFILE_PATHS = new Set([
        "home", "explore", "search", "notifications", "messages", "settings",
        "compose", "login", "signup", "i", "intent", "hashtag"
    ]);

    const frame_states = new WeakMap();

    function is_list_path(pathname){
        return typeof pathname === "string" && LIST_PATH_RE.test(pathname);
    }

    function is_home_list_tab(doc){
        const selected_tab = doc?.querySelector?.('[role="tab"][aria-selected="true"]');
        if(selected_tab == null){
            return false;
        }
        const label = normalize_display_name(selected_tab.textContent);
        return label !== "" && !HOME_NON_LIST_TAB_LABELS.has(label);
    }

    function profile_key_from_href(href){
        if(typeof href !== "string" || href.length === 0){
            return null;
        }
        let url;
        try{
            url = new URL(href, "https://x.com");
        }catch(error){
            return null;
        }
        if(url.hostname !== "x.com" && url.hostname !== "twitter.com"){
            return null;
        }
        const parts = url.pathname.split("/").filter(Boolean);
        if(parts.length !== 1){
            return null;
        }
        let key;
        try{
            key = decodeURIComponent(parts[0]);
        }catch(error){
            return null;
        }
        if(key.length === 0 || EXCLUDED_PROFILE_PATHS.has(key.toLowerCase())){
            return null;
        }
        return key.toLowerCase();
    }

    function first_profile_key(node){
        if(node == null || typeof node.querySelectorAll !== "function"){
            return null;
        }
        const links = node.querySelectorAll("a[href]");
        for(const link of links){
            const key = profile_key_from_href(link.getAttribute("href"));
            if(key != null){
                return key;
            }
        }
        return null;
    }

    function normalize_display_name(value){
        return typeof value === "string"
            ? value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
            : "";
    }

    function first_display_name(node){
        if(node == null || typeof node.querySelector !== "function"){
            return "";
        }
        const profile_link = node.querySelector("a[href]");
        if(profile_link != null){
            const linked_name = normalize_display_name(profile_link.textContent);
            if(linked_name !== ""){
                return linked_name;
            }
        }
        const first_span = node.querySelector("span");
        return normalize_display_name(first_span?.textContent);
    }

    function is_repost_context(node){
        const text = (node?.textContent || "").toLowerCase();
        return /repost|retweet|リポスト|リツイート/.test(text);
    }

    function is_same_author_repost(article){
        if(article == null || typeof article.querySelector !== "function"){
            return false;
        }
        const social_context = article.querySelector('[data-testid="socialContext"]');
        if(social_context == null || !is_repost_context(social_context)){
            return false;
        }
        const original_author = article.querySelector('[data-testid="User-Name"]');
        const reposter_key = first_profile_key(social_context);
        const author_key = first_profile_key(original_author);
        if(reposter_key != null && author_key != null){
            return reposter_key === author_key;
        }
        const reposter_name = first_display_name(social_context);
        const author_name = first_display_name(original_author);
        return reposter_name !== "" && author_name !== "" && reposter_name === author_name;
    }

    function has_paid_partnership(article){
        return typeof article?.textContent === "string"
            && article.textContent.includes("有料パートナーシップ");
    }

    function get_document_path(iframe){
        try{
            return new URL(iframe.contentWindow.location.href).pathname;
        }catch(error){
            return "";
        }
    }

    function ensure_style(doc){
        if(doc?.head == null || typeof doc.createElement !== "function"){
            return;
        }
        let style = doc.head.querySelector(`style[${STYLE_ATTR}]`);
        if(style == null){
            style = doc.createElement("style");
            style.setAttribute(STYLE_ATTR, "");
            style.textContent = `.${HIDDEN_CLASS}{display:none !important;}`;
            doc.head.appendChild(style);
        }
    }

    function clear_hidden(doc){
        if(typeof doc?.querySelectorAll !== "function"){
            return;
        }
        doc.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(function(element){
            element.classList.remove(HIDDEN_CLASS);
        });
    }

    function get_hide_target(article){
        const cell = article.closest?.('div[data-testid="cellInnerDiv"]');
        if(cell != null && cell.querySelectorAll('article[data-testid="tweet"]').length === 1){
            return cell;
        }
        return article;
    }

    function apply_filter(doc){
        if(typeof doc?.querySelectorAll !== "function"){
            return;
        }
        ensure_style(doc);
        clear_hidden(doc);
        const articles = doc.querySelectorAll('article[data-testid="tweet"]');
        articles.forEach(function(article){
            if(is_same_author_repost(article) || has_paid_partnership(article)){
                get_hide_target(article).classList.add(HIDDEN_CLASS);
            }
        });
    }

    function dispose_state(state){
        state.observer?.disconnect();
        if(state.path_timer != null){
            clearInterval(state.path_timer);
        }
        clear_hidden(state.doc);
        state.doc.querySelector(`style[${STYLE_ATTR}]`)?.remove();
    }

    function setup_frame(iframe, lifecycle){
        const doc = iframe.contentDocument;
        if(doc == null){
            return;
        }
        const previous = frame_states.get(iframe);
        if(previous?.doc === doc){
            previous.refresh();
            return;
        }
        if(previous != null){
            dispose_state(previous);
        }

        const state = {
            doc,
            path: "",
            observer: null,
            path_timer: null,
            refresh: null,
        };
        state.refresh = function(){
            state.path = get_document_path(iframe);
            if(is_list_path(state.path) || is_home_list_tab(doc)){
                apply_filter(doc);
            }else{
                clear_hidden(doc);
            }
        };
        state.observer = new MutationObserver(function(){
            state.refresh();
        });
        if(doc.documentElement != null){
            state.observer.observe(doc.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["aria-selected"],
            });
        }
        state.path_timer = setInterval(state.refresh, 1000);
        frame_states.set(iframe, state);
        lifecycle.register_column_resource(iframe, RESOURCE_KEY, function(){
            if(frame_states.get(iframe) === state){
                frame_states.delete(iframe);
            }
            dispose_state(state);
        });
        state.refresh();
    }

    function is_loaded(iframe){
        try{
            return iframe.contentDocument?.readyState === "complete"
                && iframe.contentWindow.location.href.startsWith("http");
        }catch(error){
            return false;
        }
    }

    function setup(deck_document, lifecycle){
        if(deck_document == null || lifecycle == null){
            return;
        }
        const columns = deck_document.querySelectorAll(
            '#opd_main_element div[opd_column_type="home"], '
            + '#opd_main_element div[opd_column_type="explore"]'
        );
        columns.forEach(function(column){
            const iframe = column.querySelector("iframe");
            if(iframe == null){
                return;
            }
            if(iframe.getAttribute(FRAME_ATTR) == null){
                iframe.setAttribute(FRAME_ATTR, "true");
                iframe.addEventListener("load", function(){
                    setup_frame(iframe, lifecycle);
                });
            }
            if(is_loaded(iframe)){
                setup_frame(iframe, lifecycle);
            }
        });
    }

    return {
        apply_filter,
        is_home_list_tab,
        is_list_path,
        is_repost_context,
        is_same_author_repost,
        has_paid_partnership,
        normalize_display_name,
        profile_key_from_href,
        setup,
    };
})();
