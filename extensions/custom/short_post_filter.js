//短文・誘導語・短縮リンク・短期反復が重なる投稿を非表示にする
window.opd_custom_short_post_filter = (function(){
    const HIDDEN_CLASS = "opd_custom_short_post_filter_hidden";
    const STYLE_ATTR = "opd_custom_short_post_filter_css";
    const FRAME_ATTR = "opd_custom_short_post_filter_attached";
    const RESOURCE_KEY = "short-post-filter";
    const column_dom = window.opd_custom_column_dom;
    const PATH_INTERVAL_MS = 1000;
    const SHORT_TEXT_MAX = 30;
    const REPEAT_WINDOW_MS = 30 * 60 * 1000;
    const REPEAT_MIN_COUNT = 2;
    const MAX_TRACKED_PATTERNS = 1000;
    const BAIT_RE = /続き|こちら|コチラ|↓/i;
    const SHORTENER_HOSTS = new Set([
        "t.co",
        "bit.ly",
        "tinyurl.com",
        "ow.ly",
        "goo.gl",
        "is.gd",
        "buff.ly",
        "rb.gy",
    ]);
    const EXCLUDED_PROFILE_PATHS = new Set([
        "home", "explore", "search", "notifications", "messages", "settings",
        "compose", "login", "signup", "i", "intent", "hashtag",
    ]);
    const DEFAULT_CONFIG = Object.freeze({
        enabled: true,
        min_signals: 3,
        short_text_max: SHORT_TEXT_MAX,
        repeat_window_ms: REPEAT_WINDOW_MS,
        repeat_min_count: REPEAT_MIN_COUNT,
        require_media: false,
    });

    const frame_states = new WeakMap();
    const watched_states = new Set();
    let path_timer = null;

    //全カラムを1本のschedulerで確認し、最後の監視対象が消えたら停止する。
    function start_path_watch(){
        if(path_timer != null){
            return;
        }
        path_timer = setInterval(function(){
            watched_states.forEach(function(state){
                state.refresh();
            });
            if(watched_states.size === 0){
                clearInterval(path_timer);
                path_timer = null;
            }
        }, PATH_INTERVAL_MS);
    }
    const article_observations = new WeakMap();
    const recent_patterns = new Map();
    const recent_post_observations = new Map();

    function normalize_text(value){
        if(typeof value !== "string"){
            return "";
        }
        try{
            value = value.normalize("NFKC");
        }catch(error){
            //古いブラウザーでnormalizeが使えなくても、フィルタ自体は継続する。
        }
        return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    }

    function text_length(value){
        return normalize_text(value).replace(/\s/g, "").length;
    }

    function get_attribute(node, name){
        if(node == null){
            return null;
        }
        if(typeof node.getAttribute === "function"){
            return node.getAttribute(name);
        }
        return node[name] ?? null;
    }

    function shortener_host_from_url(value){
        if(typeof value !== "string" || value === ""){
            return null;
        }
        let url;
        try{
            url = new URL(value, "https://x.com");
        }catch(error){
            return null;
        }
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        return SHORTENER_HOSTS.has(host) ? host : null;
    }

    function expanded_host_from_link(link){
        const candidates = [
            get_attribute(link, "data-expanded-url"),
            get_attribute(link, "title"),
            get_attribute(link, "aria-label"),
        ];
        for(const candidate of candidates){
            if(typeof candidate !== "string" || candidate === ""){
                continue;
            }
            try{
                return new URL(candidate, "https://x.com").hostname.toLowerCase();
            }catch(error){
                //表示文字列など、URLでない属性は無視する。
            }
        }
        return null;
    }

    function short_link_details(tweet_text){
        if(tweet_text == null || typeof tweet_text.querySelectorAll !== "function"){
            return { detected: false, host: null, expanded_host: null };
        }
        const links = tweet_text.querySelectorAll("a[href]");
        for(const link of links){
            const host = shortener_host_from_url(get_attribute(link, "href"));
            if(host != null){
                return {
                    detected: true,
                    host,
                    expanded_host: expanded_host_from_link(link),
                };
            }
        }
        return { detected: false, host: null, expanded_host: null };
    }

    function profile_key_from_href(href){
        if(typeof href !== "string" || href === ""){
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
        if(key === "" || EXCLUDED_PROFILE_PATHS.has(key.toLowerCase())){
            return null;
        }
        return key.toLowerCase();
    }

    function profile_key_from_article(article){
        const user_name = article?.querySelector?.('[data-testid="User-Name"]');
        if(user_name == null){
            return null;
        }
        const direct_key = profile_key_from_href(get_attribute(user_name, "href"));
        if(direct_key != null){
            return direct_key;
        }
        if(typeof user_name.querySelectorAll !== "function"){
            return null;
        }
        for(const link of user_name.querySelectorAll("a[href]")){
            const key = profile_key_from_href(get_attribute(link, "href"));
            if(key != null){
                return key;
            }
        }
        return null;
    }

    function post_id_from_article(article){
        if(typeof article?.querySelectorAll !== "function"){
            return null;
        }
        for(const link of article.querySelectorAll("a[href]")){
            const href = get_attribute(link, "href");
            if(typeof href !== "string"){
                continue;
            }
            const match = href.match(/\/status\/(\d+)/i);
            if(match != null){
                return match[1];
            }
        }
        return null;
    }

    function has_media(article){
        if(typeof article?.querySelector !== "function"){
            return false;
        }
        return article.querySelector('[data-testid="tweetPhoto"]') != null
            || article.querySelector('[data-testid="videoPlayer"]') != null
            || article.querySelector("video") != null
            || article.querySelector('img[src*="pbs.twimg.com/media/"]') != null;
    }

    function template_fingerprint(value){
        const canonical = normalize_text(value)
            .replace(/https?:\/\/\S+/g, "<url>")
            .replace(/@[a-z0-9_]+/gi, "<user>")
            .replace(/\d+/g, "<number>")
            .replace(/続き|こちら|コチラ|↓/gi, "<bait>");
        let hash = 2166136261;
        for(const character of canonical){
            hash ^= character.codePointAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return `${hash >>> 0}:${canonical.length}`;
    }

    function extract_post_features(article, config = DEFAULT_CONFIG){
        const tweet_text = article?.querySelector?.('[data-testid="tweetText"]');
        const body = normalize_text(tweet_text?.textContent);
        const link_details = short_link_details(tweet_text);
        return {
            article,
            body,
            body_length: text_length(body),
            short_text: body !== "" && text_length(body) <= config.short_text_max,
            bait_phrase: BAIT_RE.test(body),
            short_link: link_details.detected,
            short_link_host: link_details.host,
            expanded_host: link_details.expanded_host,
            has_media: has_media(article),
            author_key: profile_key_from_article(article),
            post_id: post_id_from_article(article),
            fingerprint: body === "" ? "" : template_fingerprint(body),
            repeated: false,
        };
    }

    function signal_count(features){
        return [
            features?.short_text === true,
            features?.bait_phrase === true,
            features?.short_link === true,
            features?.repeated === true,
        ].filter(Boolean).length;
    }

    function should_hide(features, config = DEFAULT_CONFIG){
        if(config.enabled === false || features == null){
            return false;
        }
        if(config.require_media === true && features.has_media !== true){
            return false;
        }
        return signal_count(features) >= config.min_signals;
    }

    function prune_recent(now, window_ms){
        for(const [key, timestamps] of recent_patterns){
            const current = timestamps.filter((timestamp) => now - timestamp <= window_ms);
            if(current.length === 0){
                recent_patterns.delete(key);
            }else{
                recent_patterns.set(key, current);
            }
        }
        for(const [key, timestamp] of recent_post_observations){
            if(now - timestamp > window_ms){
                recent_post_observations.delete(key);
            }
        }
    }

    function record_repeat(features, now, config){
        if(features.author_key == null || features.fingerprint === ""){
            return false;
        }
        const pattern_key = `${features.author_key}\u0000${features.fingerprint}`;
        const previous_article = article_observations.get(features.article);
        const is_same_article = previous_article?.pattern_key === pattern_key
            && now - previous_article.last_seen <= config.repeat_window_ms;
        let is_new_post = !is_same_article;
        if(features.post_id != null){
            const post_observation_key = `${pattern_key}\u0000${features.post_id}`;
            const previous_post = recent_post_observations.get(post_observation_key);
            is_new_post = previous_post == null || now - previous_post > config.repeat_window_ms;
            recent_post_observations.set(post_observation_key, now);
        }
        article_observations.set(features.article, {
            pattern_key,
            last_seen: now,
        });
        const timestamps = recent_patterns.get(pattern_key) ?? [];
        if(is_new_post){
            timestamps.push(now);
        }
        recent_patterns.set(pattern_key, timestamps);
        while(recent_patterns.size > MAX_TRACKED_PATTERNS){
            recent_patterns.delete(recent_patterns.keys().next().value);
        }
        return timestamps.filter((timestamp) => now - timestamp <= config.repeat_window_ms).length
            >= config.repeat_min_count;
    }

    function ensure_style(doc){
        if(doc?.head == null || typeof doc.createElement !== "function"){
            return;
        }
        let style = doc.head.querySelector?.(`style[${STYLE_ATTR}]`);
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

    function apply_filter(doc, options = {}){
        if(typeof doc?.querySelectorAll !== "function"){
            return { hidden: 0, entries: [] };
        }
        const config = Object.assign({}, DEFAULT_CONFIG, options.config ?? {});
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        prune_recent(now, config.repeat_window_ms);
        ensure_style(doc);
        clear_hidden(doc);
        const entries = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'))
            .map((article) => extract_post_features(article, config));
        entries.forEach(function(features){
            features.repeated = record_repeat(features, now, config);
        });
        let hidden = 0;
        entries.forEach(function(features){
            if(!should_hide(features, config)){
                return;
            }
            get_hide_target(features.article).classList.add(HIDDEN_CLASS);
            hidden += 1;
        });
        return { hidden, entries };
    }

    function dispose_state(state){
        state.observer?.disconnect();
        watched_states.delete(state);
        if(state.refresh_timer != null){
            clearTimeout(state.refresh_timer);
            state.refresh_timer = null;
        }
        clear_hidden(state.doc);
        state.doc.querySelector?.(`style[${STYLE_ATTR}]`)?.remove();
    }

    function should_apply_path(pathname){
        return /^\/home\/?$/i.test(pathname || "")
            || /^\/i\/lists\//i.test(pathname || "")
            || /^\/explore(?:\/|$)/i.test(pathname || "")
            || /^\/search(?:\/|$)/i.test(pathname || "");
    }

    function get_document_path(iframe){
        try{
            return new URL(iframe.contentWindow.location.href).pathname;
        }catch(error){
            return "";
        }
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
            refresh_timer: null,
            refresh: null,
            schedule_refresh: null,
        };
        state.refresh = function(){
            state.path = get_document_path(iframe);
            if(should_apply_path(state.path)){
                apply_filter(doc);
            }else{
                clear_hidden(doc);
            }
        };
        state.schedule_refresh = function(){
            if(state.refresh_timer != null){
                return;
            }
            state.refresh_timer = setTimeout(function(){
                state.refresh_timer = null;
                state.refresh();
            }, 50);
        };
        state.observer = new MutationObserver(function(){
            state.schedule_refresh();
        });
        if(doc.documentElement != null){
            state.observer.observe(doc.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["href", "title", "aria-label"],
            });
        }
        watched_states.add(state);
        start_path_watch();
        frame_states.set(iframe, state);
        lifecycle.register_column_resource(iframe, RESOURCE_KEY, function(){
            if(frame_states.get(iframe) === state){
                frame_states.delete(iframe);
            }
            dispose_state(state);
        });
        state.refresh();
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
            if(column_dom.is_frame_loaded(iframe)){
                setup_frame(iframe, lifecycle);
            }
        });
    }

    return {
        DEFAULT_CONFIG,
        apply_filter,
        extract_post_features,
        has_media,
        normalize_text,
        profile_key_from_href,
        record_repeat,
        should_apply_path,
        should_hide,
        shortener_host_from_url,
        signal_count,
        template_fingerprint,
        setup,
    };
})();
