//メディアビューワー停止用
(() => {
    let opd_send_media_info_token = null;
    //カラム側の画像表示を停止させて、表示画像などの情報をOPD側に渡す
    //引用内のメディアをクリックした場合は、外側のポストではなく引用側のメディアを優先する。
    document.addEventListener("click", (e) => {
        // ネイティブ動画コントロールと再生/一時停止ボタンは、拡大ビューアーに渡さない。
        // 動画コントロールの内部要素は Shadow DOM のため、composedPath で確認する。
        const click_path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
        const is_playback_control = click_path.some((element) => {
            if(element?.tagName === "VIDEO"){
                return true;
            }
            const label = element?.getAttribute?.("aria-label")?.trim().toLocaleLowerCase();
            return label === "play" || label === "pause" || label === "再生" || label === "一時停止";
        });
        if(is_playback_control){
            return;
        }

        //Alt(Option)キーが押されている場合はメディアビューワーを使用しないようにする
        if (e.altKey) {
            const target_root = e.target.closest('div[data-testid="cellInnerDiv"]');
            if (target_root) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            
                const target = e.target.closest('a[href]')
                if (target){
                    target.click();
                }
            }
            return;
        }

        //引用の場合に格納される
        const quoted = e.target.closest('div[tabindex="0"][role="link"]');
        // 通常のメディア付きツイート
        const img = e.target.closest('img, div[data-testid="videoComponent"]');
        if (!img) return;

        //プレイヤーが動作している場合のPropsを取得する
        let video_wrapper_props = null;
        if(img.getAttribute("data-testid") === "videoComponent"){
            video_wrapper_props = get_props(img.querySelector('div[tabindex="0"]'), "Props");
        }

        //ルートのPropsを取得
        let root_props = get_props(img.closest('div[aria-labelledby][id]'), "Props");//:not([data-testid="card.wrapper"])
        if(quoted){
            root_props = get_props(quoted, "Props")
        }

        //プレイヤーが存在している場合の現在再生ソースを取得
        const current_video_source = video_wrapper_props?.children?.props?.playerState;

        //メディアソースの一覧を取得
        let media_details = root_props?.children?.[1]?.props?.children?.[0]?.props?.mediaDetails;

        //引用の場合のメディアソースの一覧を取得
        let media_details_quoted = root_props?.children?.[2]?.props?.tweet?.extended_entities?.media;
        if(quoted){
            //Xはカラム幅や遅延描画によって引用カードのchildren構造を変える。
            //固定添字ではなく、クリックした画像URLに対応するメディア配列を引用カード内から探す。
            media_details_quoted = find_media_details(root_props, img?.src, current_video_source?.posterImage);
            media_details = media_details_quoted ?? media_details;
        }else{
            media_details ??= media_details_quoted;
        }

        //TwitterCardなどの場合は、一旦対象外とする
        if(!Array.isArray(media_details) || media_details.length === 0) return;
        
        //ビューワー自体の動作を止める
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        //動画をミュートにする
        const video_elem = img.querySelector("video");
        if(video_elem){
            video_elem.pause();
            video_elem.muted = true;
        }

        //画像の現在値とメディア情報を送信する
        let is_send = false;
        for (let index = 0; index < media_details.length; index++) {
            const media = media_details[index];
            const media_url = media?.media_url_https;
            if(media_url_matches(img?.src, media_url)){
                window.parent.document.dispatchEvent(new CustomEvent('opd_send_media_info', {
                    bubbles: true,
                    composed: true,
                    detail: JSON.stringify({ token:opd_send_media_info_token, media_info:media_details, selected_index:index })
                }));
                is_send = true;
                break;
            }else if(current_video_source?.posterImage === media?.media_url_https){
                window.parent.document.dispatchEvent(new CustomEvent('opd_send_media_info', {
                    bubbles: true,
                    composed: true,
                    detail: JSON.stringify({ token:opd_send_media_info_token, media_info:media_details, selected_index:index })
                }));
                is_send = true;
                break;
            }
        }
        //現在値が取得できなかった場合は0で送信する
        if(!is_send){
            window.parent.document.dispatchEvent(new CustomEvent('opd_send_media_info', {
                bubbles: true,
                composed: true,
                detail: JSON.stringify({ token:opd_send_media_info_token, media_info:media_details, selected_index:0 })
            }));
        }
    }, true);
    //ReactProps取得関数
    function get_props(elem, type){
        if (!elem) return;
        const prop_type = type === "Props" ? type : "Fiber";
        const propsKey = Object.getOwnPropertyNames(elem).find(k => k.includes(`__react${prop_type}$`));
        return propsKey ? elem[propsKey] : null;
    }

    function media_url_matches(image_src, media_url){
        if(typeof image_src !== "string" || typeof media_url !== "string"){
            return false;
        }
        const media_without_extension = media_url.replace(/\.(?:jpe?g|png|webp)$/i, "");
        return image_src.includes(media_url) || image_src.includes(media_without_extension);
    }

    function find_media_details(root, image_src, poster_image){
        if(root == null || typeof root !== "object"){
            return null;
        }

        const queue = [root];
        const visited = new WeakSet();
        const candidates = [];
        const max_nodes = 2000;
        let cursor = 0;

        while(cursor < queue.length && cursor < max_nodes){
            const current = queue[cursor++];
            if(current == null || typeof current !== "object" || visited.has(current)){
                continue;
            }
            visited.add(current);

            if(Array.isArray(current.mediaDetails) && current.mediaDetails.length > 0){
                candidates.push(current.mediaDetails);
            }
            const legacy_media = current.extended_entities?.media;
            if(Array.isArray(legacy_media) && legacy_media.length > 0){
                candidates.push(legacy_media);
            }

            let values;
            try{
                values = Object.values(current);
            }catch(_error){
                continue;
            }
            values.forEach(function(value){
                if(value != null && typeof value === "object"){
                    queue.push(value);
                }
            });
        }

        const matching = candidates.find(function(media_items){
            return media_items.some(function(media){
                const media_url = media?.media_url_https;
                return media_url_matches(image_src, media_url) || poster_image === media_url;
            });
        });
        return matching ?? candidates[0] ?? null;
    }

    //機能動作用のトークンを設定
    document.addEventListener('opd_send_media_info_init', (e)=>{
        const detail = JSON.parse(e.detail);
        opd_send_media_info_token = detail.token;
    }, true);
})();