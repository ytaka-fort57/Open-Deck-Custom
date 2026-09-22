//XのプロフィールURLから作者を識別するキーを取り出す。
//リスト返信フィルタと短文フィルタが同じリンクに同じ作者判定を返すよう、規則はここだけに置く。
window.opd_custom_x_profile_url = (function(){
    //単一パスでもプロフィールではないXの予約パス
    const EXCLUDED_PROFILE_PATHS = new Set([
        "home", "explore", "search", "notifications", "messages", "settings",
        "compose", "login", "signup", "i", "intent", "hashtag",
    ]);

    //x.com / twitter.com の単一パスだけをプロフィールとみなし、小文字のキーを返す。
    //相対URLは x.com 基準で解決する。プロフィールでなければ null。
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

    return {
        EXCLUDED_PROFILE_PATHS,
        profile_key_from_href,
    };
})();
