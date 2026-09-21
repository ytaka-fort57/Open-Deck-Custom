//メディア選択はXのReact propsを手掛かりにするため、fixtureでも同じ形の props を置く。
//DOM全体の模倣はしない。参照される経路だけを最小の入れ子で再現する。
(function(){
    const PROPS_KEY = "__reactProps$opdfixture";

    function photo(name){
        return {
            type: "photo",
            id_str: name,
            media_url_https: "https://pbs.twimg.com/media/" + name + ".jpg",
        };
    }

    const direct_media = [photo("opd-e2e-direct-1"), photo("opd-e2e-direct-2")];
    const quote_media = [photo("opd-e2e-quote-1"), photo("opd-e2e-quote-2")];

    //引用でない投稿: root_props.children[1].props.children[0].props.mediaDetails
    function outer_props(media){
        return {children: [null, {props: {children: [{props: {mediaDetails: media}}]}}]};
    }

    //引用コンテナ:
    //root_props.children[0][0].props.children[1].props.children[5].props.children.props.mediaDetails
    function quoted_props(media, compact){
        if(compact){
            return {
                children: [
                    {props: {attachment: {props: {children: {props: {mediaDetails: media}}}}}},
                ],
            };
        }
        return {
            children: [[
                {props: {children: [null, {props: {children: [
                    null, null, null, null, null,
                    {props: {children: {props: {mediaDetails: media}}}},
                ]}}]}},
            ]],
        };
    }

    const direct_root = document.getElementById("opd_fixture_direct_root");
    if(direct_root != null){
        direct_root[PROPS_KEY] = outer_props(direct_media);
    }
    //引用元のメディアを外側へ置き、引用側が優先されることを見分けられるようにする
    const quote_root = document.getElementById("opd_fixture_quote_root");
    if(quote_root != null){
        quote_root[PROPS_KEY] = outer_props(direct_media);
    }
    const quote_container = document.getElementById("opd_fixture_quote_container");
    if(quote_container != null){
        const timeline_frames = Array.from(parent.document.querySelectorAll('#first_rack_element iframe[src*="/home"]'));
        const is_compact_column = timeline_frames.indexOf(window.frameElement) > 0;
        quote_container[PROPS_KEY] = quoted_props(quote_media, is_compact_column);
    }
})();
