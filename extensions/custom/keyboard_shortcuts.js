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

    function handle_key(event, deck_document){
        const dialog = find_open_viewer(deck_document);
        if(dialog == null){
            return;
        }
        let handled = false;
        switch(event.key){
            case "Escape":
                //closeイベント経由で本家の後片付けが走る
                dialog.close();
                handled = true;
                break;
            case "ArrowLeft":
                click_button(dialog, "[data-media-forward]");
                handled = true;
                break;
            case "ArrowRight":
                click_button(dialog, "[data-media-next]");
                handled = true;
                break;
        }
        if(handled){
            //X側のスクロールなどを起こさせない
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function attach(doc, deck_document){
        if(doc == null || attached_docs.has(doc)){
            return;
        }
        attached_docs.add(doc);
        doc.addEventListener("keydown", function(event){
            handle_key(event, deck_document);
        }, true);
    }

    return {
        attach: attach
    };
})();
