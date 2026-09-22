//文章校正の指摘をDOMや通信から独立して扱う純粋モデル。
window.opd_custom_text_review_model = (function(){
    function is_code_point_boundary(text, index){
        if(index <= 0 || index >= text.length){
            return true;
        }
        const before = text.charCodeAt(index - 1);
        const after = text.charCodeAt(index);
        return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
    }

    function normalize_indications(text, result){
        if(typeof text !== "string" || !Array.isArray(result)){
            return [];
        }
        const sorted = result.filter(function(indication){
            if(indication == null
                || !Number.isInteger(indication.offset)
                || !Number.isInteger(indication.length)){
                return false;
            }
            if(indication.offset < 0 || indication.length < 0){
                return false;
            }
            const end = indication.offset + indication.length;
            return end <= text.length
                && is_code_point_boundary(text, indication.offset)
                && is_code_point_boundary(text, end);
        }).sort(function(left, right){
            return left.offset - right.offset || left.length - right.length;
        });

        const normalized = [];
        let current_end = 0;
        for(const indication of sorted){
            if(indication.offset < current_end){
                continue;
            }
            normalized.push(indication);
            current_end = indication.offset + indication.length;
        }
        return normalized;
    }

    function last_suggestion(indication){
        const suggestions = indication?.params?.suggests;
        return Array.isArray(suggestions) && suggestions.length > 0
            ? String(suggestions[suggestions.length - 1])
            : "";
    }

    function create_preview_model(text, indications, create_id){
        const items = normalize_indications(text, indications).map(function(indication){
            return {
                indication,
                id: create_id(),
                enabled: false,
            };
        });
        const segments = [];
        let current = 0;
        items.forEach(function(item){
            const start = item.indication.offset;
            const end = start + item.indication.length;
            if(start > current){
                segments.push({ type: "text", text: text.slice(current, start) });
            }
            segments.push({
                type: "indication",
                id: item.id,
                offset: start,
                length: item.indication.length,
                problem: text.slice(start, end),
                suggestion: last_suggestion(item.indication),
            });
            current = end;
        });
        if(current < text.length || segments.length === 0){
            segments.push({ type: "text", text: text.slice(current) });
        }
        return { items, segments };
    }

    function apply_selected(text, items){
        if(!Array.isArray(items) || items.length === 0){
            return text;
        }
        let current = 0;
        let output = "";
        items.forEach(function(item){
            const indication = item.indication;
            const start = indication.offset;
            const end = start + indication.length;
            output += text.slice(current, start);
            output += item.enabled ? last_suggestion(indication) : text.slice(start, end);
            current = end;
        });
        return output + text.slice(current);
    }

    return {
        apply_selected,
        create_preview_model,
        normalize_indications,
    };
})();
