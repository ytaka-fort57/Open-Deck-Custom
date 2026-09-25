//デッキ本体のURL判定
//popup は twitter.com/run-opdeck を開き、X は x.com へリダイレクトする際にクエリ(?mx=1 など)を付けることがある。
//URL全体の完全一致だとデッキが起動せず X の 404 ページのままになるため、ホストとパスだけで判定する。
window.opd_custom_deck_url = (function(){
    const DECK_PATH = "/run-opdeck";
    const DECK_HOSTS = new Set(["x.com", "twitter.com"]);

    //manifest の matches (https://*.x.com/*) と同じく、www. などのサブドメインも含める
    function is_deck_host(hostname){
        const host = String(hostname || "").toLowerCase();
        for(const base of DECK_HOSTS){
            if(host === base || host.endsWith(`.${base}`)){
                return true;
            }
        }
        return false;
    }

    //クエリとハッシュは無視し、末尾スラッシュ1つまで許す
    function is_deck_url(href){
        let url;
        try{
            url = new URL(String(href));
        }catch(error){
            return false;
        }
        if(url.protocol !== "https:" || !is_deck_host(url.hostname)){
            return false;
        }
        const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
        return path === DECK_PATH;
    }

    return Object.freeze({DECK_PATH, is_deck_url});
})();
