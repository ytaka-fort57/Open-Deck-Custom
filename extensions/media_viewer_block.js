// メディアビューワー停止用
class OpdMediaViewerBlocker {
    constructor() {
        this.opd_send_media_info_token = null;
        this.Init = (column_frame) => {
            //ヘルパースクリプト追加とトークンの受け渡し
            this.opd_send_media_info_token = window.opd_custom_helper_injector.inject(
                column_frame.contentWindow,
                "extensions/media_viewer_block_helper.js",
                'opd_send_media_info_init'
            );
        }
    }
}