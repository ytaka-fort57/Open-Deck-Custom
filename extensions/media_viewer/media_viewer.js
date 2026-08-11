// メディアビューワー
class OpdExtMediaViewer {
    constructor() {
        this.Preview = (media_info, pre_index, callback=()=>{}) => {
            let current_media_idx = pre_index;
            const media_viewer_div = document.createElement("div");
            const media_viewer_dialog = document.createElement("dialog");
            const safe_values = window.opd_custom_safe_values;
            const mediaURL = (info) => {
                let raw_url = null;
                if (["animated_gif", "video"].includes(info?.type)) {
                    return safe_values.select_video_variant_url(info.video_info?.variants);
                }else if(info?.type === "photo"){
                    raw_url = info.media_url_https;
                }
                const normalized_url = safe_values.normalize_https_url(raw_url);
                if(normalized_url == null || info?.type !== "photo"){
                    return normalized_url;
                }
                const photo_url = new URL(normalized_url);
                photo_url.searchParams.set("name", "orig");
                return photo_url.href;
            };
            const createMediaElement = (info) => {
                const source = mediaURL(info);
                if(source == null){
                    return null;
                }
                const is_video = ["animated_gif", "video"].includes(info.type);
                const element = document.createElement(is_video ? "video" : "img");
                element.dataset.media = "";
                element.style.cssText = "width:auto;height:auto;max-width:calc(100% - 160px);max-height:100%;object-fit:contain;";
                element.src = source;
                if(is_video){
                    element.controls = true;
                    element.autoplay = true;
                    element.playsInline = true;
                    element.addEventListener("loadedmetadata", () => {
                        element.volume = 0.2;
                    }, {once: true});
                }
                return element;
            };

            const stopVideo = (elem) => {
                if (!elem || elem.tagName !== "VIDEO") return;
                try {
                    elem.pause();
                    elem.removeAttribute("src");
                    elem.load();
                } catch (error) {}
            };

            const setMedia = (idx) => {
                const current = media_viewer_dialog.querySelector("[data-media]");
                const nextInfo = media_info[idx];
                if (!current || !nextInfo) return false;
                const next_element = createMediaElement(nextInfo);
                if(next_element == null){
                    return false;
                }
                stopVideo(current);
                current.replaceWith(next_element);
                return true;
            };


            Object.assign(media_viewer_dialog, {
                id: "opd_media_viewer",
                style: "z-index:999999;border:none;background:none;padding:0;display:flex;flex-direction:column;align-items:center;gap:12px;width:85vw;height:85vh;overflow:hidden;"
            });
            media_viewer_dialog.closedBy = "any";
            media_viewer_dialog.innerHTML = `
            <div style="width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;align-items:center;">
                <div class="opd_media_viewer_func_btn_circle" style="display:flex;width:100%;justify-content:flex-end;">
                    <button type="button" data-close><span class="media_viewer_icon_close opd_media_viewer_func_btn_icon_color"></span></button>
                </div>

                <div style="display:flex;flex-direction:row;flex:1;min-height:0;overflow:hidden;align-items:center;width:fit-content;">
                    <button type="button" class="opd_media_viewer_func_btn media_switch_btn" data-media-forward><span class="media_viewer_icon_forward opd_media_viewer_func_btn_icon_color"></span></button>
                    <div data-media-container style="display:contents;"></div>
                    <button type="button" class="opd_media_viewer_func_btn media_switch_btn" data-media-next><span class="media_viewer_icon_next opd_media_viewer_func_btn_icon_color"></span></button>
                </div>

                <div class="opd_media_viewer_func_btn_circle" style="width:100%;margin-top:10px;display:flex;justify-content:center;">
                    <button type="button" data-media-download><span class="media_viewer_icon_download opd_media_viewer_func_btn_icon_color"></span></button>
                </div>
            </div>
            `;
            const initial_media = createMediaElement(media_info[current_media_idx]);
            if(initial_media == null){
                return;
            }
            media_viewer_dialog.querySelector("[data-media-container]").appendChild(initial_media);
            media_viewer_div.appendChild(media_viewer_dialog);
            const append_viewer_element = document.body.appendChild(media_viewer_div);

            //Videoの音量設定
            let video_element = append_viewer_element.getElementsByTagName('video')[0];
            if(video_element){
                //音量の大きい動画が急に再生されるとびっくりするので、音量を下げておく
                video_element.volume = 0.2;
            }

            function media_viewer_close(){
                video_element = append_viewer_element.getElementsByTagName('video')[0];
                if(video_element){
                    //稀にビューワーを閉じた後でもVideoが再生されてしまう場合があるので念のため、Videoを止めて消す
                    video_element.pause();
                    video_element.remove();
                }
                media_viewer_div.remove();

                //callbackを実行する
                callback();
            }

            media_viewer_dialog.addEventListener("close", () => media_viewer_close());
            media_viewer_dialog.querySelector("[data-close]")?.addEventListener("click", () => media_viewer_close());

            //背景クリックで閉じやすくする
            media_viewer_dialog.addEventListener("click", (event)=>{
                const tag_name = event.target.tagName;
                const allowed_tag = ["IMG", "VIDEO", "SPAN", "BUTTON"];
                if(!allowed_tag.includes(tag_name)){
                    media_viewer_close();
                }
            })


            this.SkipBtnDisabled(media_viewer_dialog, media_info, current_media_idx);

            media_viewer_dialog.querySelector("[data-media-forward]").addEventListener("click", () => {

                this.SkipBtnDisabled(media_viewer_dialog, media_info, current_media_idx);

                if (current_media_idx === 0) return;

                const forward_idx = current_media_idx - 1;
                if(!setMedia(forward_idx)) return;
                current_media_idx = forward_idx;

                this.SkipBtnDisabled(media_viewer_dialog, media_info, current_media_idx);
            });

            media_viewer_dialog.querySelector("[data-media-next]").addEventListener("click", () => {
                const next_idx = current_media_idx + 1;

                if (media_info.length === next_idx) return;

                if(!setMedia(next_idx)) return;
                current_media_idx = next_idx;

                this.SkipBtnDisabled(media_viewer_dialog, media_info, current_media_idx);
            });

            media_viewer_dialog.querySelector("[data-media-download]").addEventListener("click", () => {
                this.DownloadMedia(media_info[current_media_idx]);
            })

            media_viewer_dialog.showModal();
        }

        this.SkipBtnDisabled = (dialog_elem, media_info, current_media_idx) => {
            const next_btn = dialog_elem.querySelector("[data-media-next]");
            const prev_btn = dialog_elem.querySelector("[data-media-forward]");
            if (!next_btn || !prev_btn) return;

            if (media_info.length === 1) {
                prev_btn.setAttribute("disabled", "");
                next_btn.setAttribute("disabled", "");
                return;
            }

            prev_btn.removeAttribute("disabled");
            next_btn.removeAttribute("disabled");

            switch (current_media_idx) {
                case 0:
                    prev_btn.setAttribute("disabled", "");
                    break;

                case media_info.length - 1:
                    next_btn.setAttribute("disabled", "");
                    break;
            }
        }
        this.DownloadMedia = async (media) => {
            let raw_media_src = null;
            if (["animated_gif","video"].includes(media?.type)) {
                raw_media_src = window.opd_custom_safe_values.select_video_variant_url(media.video_info?.variants);
            }
            if (media?.type === "photo") {
                raw_media_src = media.media_url_https;
            }
            const normalized_media_src = window.opd_custom_safe_values.normalize_https_url(raw_media_src);
            if(normalized_media_src == null){
                return;
            }
            const media_url = new URL(normalized_media_src);
            if(media?.type === "photo"){
                media_url.searchParams.set("name", "orig");
            }
            const media_src = media_url.href;
            const res = await fetch(media_src);
            const blob = await res.blob();

            const a = document.createElement("a");
            const objectUrl = URL.createObjectURL(blob);

            a.href = objectUrl;
            a.download = media.id_str ?? "";
            document.body.appendChild(a);
            a.click();

            URL.revokeObjectURL(objectUrl);
            document.body.removeChild(a);
        }
    }
}