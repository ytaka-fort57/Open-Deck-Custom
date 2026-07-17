//メディアビューアーのキーボード操作
//ビューアーはデッキ本体の<dialog>だが、画像をクリックした時点でフォーカスは
//カラムのiframe(Xのページ)側にある。キー入力はフォーカスのある文書にしか届かないため、
//デッキ本体とすべてのカラムの文書の両方で受け取る。
window.opd_custom_keyboard = (function(){
    const VIEWER_ID = "opd_media_viewer";
    const attached_docs = new WeakSet();

    function find_open_viewer(deck_document){
        const dialog = deck_document.getElementById(VIEWER_ID);
        if(dialog == null || !dialog.open){
            return null;
        }
        return dialog;
    }

    function click_button(dialog, selector){
        const button = dialog.querySelector(selector);
        //端まで来ている場合はdisabledのため何もしない
        if(button == null || button.disabled){
            return;
        }
        button.click();
    }

    //文字入力中のBackspaceを奪うと文字が消せなくなる
    function is_typing(event){
        const element = event.target;
        if(element == null){
            return false;
        }
        if(element.isContentEditable){
            return true;
        }
        return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
    }

    function handle_viewer_key(event, dialog){
        switch(event.key){
            case "Escape":
                //closeイベント経由で本家の後片付けが走る
                dialog.close();
                return true;
            case "ArrowLeft":
                click_button(dialog, "[data-media-forward]");
                return true;
            case "ArrowRight":
                click_button(dialog, "[data-media-next]");
                return true;
        }
        return false;
    }

    //iframe はキーを受け取ったカラム。デッキ本体の場合は null
    function handle_key(event, deck_document, iframe){
        let handled = false;
        const dialog = find_open_viewer(deck_document);
        if(dialog != null){
            handled = handle_viewer_key(event, dialog);
        }else if(event.key === "Backspace" && iframe != null && !is_typing(event)){
            //ブラウザーの戻るは別のカラムを動かしてしまうため、独自履歴で戻す
            handled = window.opd_custom_column_history.back(iframe);
        }
        if(handled){
            //X側のスクロールなどを起こさせない
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function attach(doc, deck_document, iframe){
        if(doc == null || attached_docs.has(doc)){
            return;
        }
        attached_docs.add(doc);
        doc.addEventListener("keydown", function(event){
            handle_key(event, deck_document, iframe != undefined ? iframe : null);
        }, true);
    }

    return {
        attach: attach
    };
})();
