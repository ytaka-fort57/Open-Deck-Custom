// 自動更新機能で使用
class OpdExtAutoReload {
    constructor() {
        this.opd_reload_token = null;
        this.Init = (column_frame) => {
            //ヘルパースクリプト追加とトークンの受け渡し
            this.opd_reload_token = window.opd_custom_helper_injector.inject(
                column_frame.contentWindow,
                "extensions/auto_reload_helper.js",
                'opd_column_reload_init'
            );
        }
        this.Reload = (column_window)=>{
            if (!this.opd_reload_token) return false;
            column_window.document.dispatchEvent(new CustomEvent('opd_column_reload', {
                bubbles: true,
                composed: true,
                detail: JSON.stringify({ token:this.opd_reload_token })
            }));
        }
    }
}