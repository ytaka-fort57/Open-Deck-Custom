//本家Open-Deckから書き出した設定をカスタム版へ取り込む
//本家とカスタム版は別の拡張機能となりstorageを共有できないため、JSON経由で受け渡す
window.addEventListener("load", function(){

    function set_status(message, is_error){
        const status_area = document.getElementById("import_status");
        status_area.textContent = message;
        status_area.style.color = is_error ? "red" : "green";
    }

    //入力JSONを {opd_profile_store, opd_settings} へ正規化する
    //opd_settingsを含まない入力の場合、opd_settingsはnullを返す
    function normalize_import_data(input_data){
        //カスタム版の書き出し形式
        if(input_data != null && !Array.isArray(input_data) && typeof input_data === "object" && input_data.opd_profile_store !== undefined){
            const profile_store = typeof input_data.opd_profile_store === "string" ? JSON.parse(input_data.opd_profile_store) : input_data.opd_profile_store;
            let settings = null;
            if(input_data.opd_settings != null){
                settings = typeof input_data.opd_settings === "string" ? JSON.parse(input_data.opd_settings) : input_data.opd_settings;
            }
            return {opd_profile_store: profile_store, opd_settings: settings};
        }
        //試作版v1.0.5以前の形式
        if(input_data != null && !Array.isArray(input_data) && typeof input_data === "object" && input_data.row_settings !== undefined){
            return {opd_profile_store: [{name: "default", profile: input_data.row_settings}], opd_settings: null};
        }
        //本家プロファイル書き出しの形式
        if(Array.isArray(input_data)){
            return {opd_profile_store: input_data, opd_settings: null};
        }
        return null;
    }

    function validate_profile_store(profile_store){
        if(!Array.isArray(profile_store) || profile_store.length == 0){
            return false;
        }
        return profile_store.every(function(profile){
            return profile != null && typeof profile.name === "string" && profile.profile !== undefined;
        });
    }

    function save_import_data(import_data){
        chrome.storage.local.set({'opd_profile_store': JSON.stringify(import_data.opd_profile_store)}, function(){
            chrome.storage.local.get("opd_settings", function(value){
                //opd_settingsを含む入力はそのまま採用し、含まない入力は現在の設定を残す
                let load_setting = import_data.opd_settings;
                if(load_setting == null){
                    if(value.opd_settings == null){
                        //本家プロファイルのみの入力で、カスタム版の設定が未作成の場合
                        //設定はデッキ側の初期化に任せ、プロファイルのみ取り込む
                        set_status("プロファイルを取り込みました。Open-Deckの画面を再読み込みしてください。", false);
                        return;
                    }
                    load_setting = JSON.parse(value.opd_settings);
                }
                load_setting.last_load_profile = 0;
                chrome.storage.local.set({'opd_settings': JSON.stringify(load_setting)}, function(){
                    set_status("インポートが完了しました。Open-Deckの画面を再読み込みしてください。", false);
                });
            });
        });
    }

    document.getElementById("import_file").addEventListener("change", function(event){
        const file = event.target.files[0];
        if(file == null){
            return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", function(){
            document.getElementById("import_input_area").value = reader.result;
            set_status("ファイルを読み込みました。内容を確認して「インポート」を押してください。", false);
        });
        reader.readAsText(file);
    });

    document.getElementById("import_btn").addEventListener("click", function(){
        const input_text = document.getElementById("import_input_area").value.trim();
        if(input_text.length == 0){
            set_status("JSONが入力されていません。", true);
            return;
        }
        let input_data = null;
        try{
            input_data = JSON.parse(input_text);
        }catch(error){
            set_status("JSONとして解釈できません: " + error.message, true);
            return;
        }
        const import_data = normalize_import_data(input_data);
        if(import_data == null || !validate_profile_store(import_data.opd_profile_store)){
            set_status("Open-Deckの設定として解釈できない形式です。本家の「プロファイル書き出し」の出力をそのまま貼り付けてください。", true);
            return;
        }
        const profile_names = import_data.opd_profile_store.map(function(profile){ return profile.name; }).join(", ");
        if(!confirm("現在のカラム構成を次のプロファイルで上書きします。よろしいですか。\n\n" + profile_names)){
            return;
        }
        save_import_data(import_data);
    });

    document.getElementById("export_btn").addEventListener("click", function(){
        chrome.storage.local.get(["opd_settings", "opd_profile_store"], function(value){
            if(value.opd_profile_store == null){
                document.getElementById("export_output_area").value = "";
                set_status("書き出せる設定がありません。先にOpen-Deckを一度開いてください。", true);
                return;
            }
            const export_data = {
                opd_settings: value.opd_settings != null ? JSON.parse(value.opd_settings) : null,
                opd_profile_store: JSON.parse(value.opd_profile_store)
            };
            document.getElementById("export_output_area").value = JSON.stringify(export_data);
            set_status("書き出しました。テキストエリアの内容を保存してください。", false);
        });
    });
});
