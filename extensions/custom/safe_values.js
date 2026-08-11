//外部データをHTML属性・URLとして使う境界を共通化する
window.opd_custom_safe_values = (function(){
    const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

    function escape_html_attribute(value){
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
    }

    function render_attribute_template(template, replacements){
        let rendered = template;
        Object.entries(replacements).forEach(function([placeholder, value]){
            rendered = rendered.replaceAll(placeholder, escape_html_attribute(value));
        });
        return rendered;
    }

    function is_safe_text(value, max_length = 512){
        return typeof value === "string"
            && value.length <= max_length
            && !CONTROL_CHARACTERS.test(value);
    }

    function is_safe_x_path(value){
        if(!is_safe_text(value, 2048) || !value.startsWith("/") || value.startsWith("//")){
            return false;
        }
        try{
            const parsed = new URL(value, "https://x.com");
            return parsed.origin === "https://x.com"
                && parsed.username === ""
                && parsed.password === "";
        }catch(error){
            return false;
        }
    }

    function normalize_https_url(value){
        if(typeof value !== "string" || CONTROL_CHARACTERS.test(value)){
            return null;
        }
        try{
            const parsed = new URL(value);
            return parsed.protocol === "https:" ? parsed.href : null;
        }catch(error){
            return null;
        }
    }

    // Xのvariants配列順は品質順とは限らないため、再生可能なMP4を明示的に選ぶ。
    // bitrateが無いanimated_gifも対象にし、MP4が無い場合だけHTTPSの代替候補を使う。
    function select_video_variant_url(variants){
        if(!Array.isArray(variants)){
            return null;
        }
        const candidates = variants.map(function(variant){
            return {
                bitrate: Number.isFinite(Number(variant?.bitrate)) ? Number(variant.bitrate) : -1,
                content_type: String(variant?.content_type || "").toLowerCase(),
                url: normalize_https_url(variant?.url),
            };
        }).filter(function(variant){
            return variant.url != null;
        });
        const mp4_candidates = candidates.filter(function(variant){
            return variant.content_type === "video/mp4";
        });
        const selectable = mp4_candidates.length > 0 ? mp4_candidates : candidates;
        selectable.sort(function(a, b){
            return b.bitrate - a.bitrate;
        });
        return selectable[0]?.url ?? null;
    }

    return {
        escape_html_attribute,
        render_attribute_template,
        is_safe_text,
        is_safe_x_path,
        normalize_https_url,
        select_video_variant_url,
    };
})();
