// メディアビューワー停止用
class OpdUtils {
    constructor() {
        this.Init = (column_frame) => {
            //ヘルパースクリプト追加(トークンなし)
            window.opd_custom_helper_injector.inject(column_frame.contentWindow, "extensions/utils_helper.js");
        }
    }
}