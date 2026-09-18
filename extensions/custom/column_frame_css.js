//カラムiframe内へ流し込むCSSの本文と、<style>の確保・更新をまとめる。
//本文は純粋関数で返し、DOMへ触るのは apply だけにする。
window.opd_custom_column_frame_css = (function(){
    const BANNER_HIDDEN_CSS = `header[role="banner"]{display:none;}`;
    const VIEW_MODE_CSS = {
        //"1": ポストだけ(リポスト等を隠す) / "2": リポスト等だけ(ポストを隠す)
        "1": `div[data-testid="cellInnerDiv"]:has(div[aria-labelledby]){visibility: hidden; height: 0;}`,
        "2": `div[data-testid="cellInnerDiv"]:not(:has(div[aria-labelledby])){visibility: hidden; height: 0;}`,
    };

    function banner_css(visible){
        return visible ? "" : BANNER_HIDDEN_CSS;
    }

    //トップ表示を隠す場合も、タイムライン上部のタブ切り替えは残す。
    function top_visible_css(column_type, visible, legacy_mode = false){
        if(visible){
            return "";
        }
        if(column_type == "post"){
            return `div[data-testid="tweetTextarea_0"], div[contenteditable="true"][data-testid*="tweetTextarea"]{display:block !important; visibility:visible !important;}[data-testid="app-bar-back"]{visibility:visible !important; display:block !important; filter:none;}`;
        }
        const top_child = `div[data-testid="primaryColumn"]>[tabindex="0"][aria-label]>div:nth-child(1)`;
        const hidden_style = legacy_mode
            ? "display:none;"
            : "visibility:hidden; height:0; top:calc(100vh - 60px); position:sticky; backdrop-filter:blur(0px) !important;";
        const top_parts = [
            `${top_child}:not(:has([role="tab"])){${hidden_style}}`,
            `${top_child} div:has(form[role="search"]):not(:has([role="tab"])){${hidden_style}}`,
            `${top_child} div:has(h2[role="heading"]):not(:has([role="tab"])){${hidden_style}}`,
        ];

        if(legacy_mode){
            if(column_type == "home"){
                top_parts.push(`div[role="progressbar"] + div{display:none;}`);
            }
            return top_parts.join("");
        }

        top_parts.push(`[data-testid="app-bar-back"]{visibility:visible; filter:none;}`);
        if(column_type == "home"){
            top_parts.push(`div[role="progressbar"] + div{display:none;}`);
        }
        top_parts.push(`div[data-testid="cellInnerDiv"]:has(button[aria-describedby], div[data-testid="UserAvatar-Container-unknown"]):not(:has(article[tabindex="-1"])){display:none;}`);
        return top_parts.join("");
    }

    function view_mode_css(mode){
        return VIEW_MODE_CSS[String(mode)] ?? "";
    }

    //<style style_attr> が無ければ head 末尾へ作り、本文を差し替える。
    //同じ属性の style を増やさないため、再適用しても1本のまま保つ。
    function apply(doc, style_attr, css_text){
        const head = doc?.querySelector?.("head");
        if(head == null){
            return null;
        }
        let style = head.querySelector(`style[${style_attr}]`);
        if(style == null){
            style = doc.createElement("style");
            style.setAttribute(style_attr, "");
            head.appendChild(style);
        }
        if(style.textContent !== css_text){
            style.textContent = css_text;
        }
        return style;
    }

    return {
        apply,
        banner_css,
        top_visible_css,
        view_mode_css,
    };
})();
