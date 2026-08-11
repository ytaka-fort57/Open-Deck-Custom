//本家Open-Deckから書き出した設定をカスタム版へ取り込む
//本家とカスタム版は別の拡張機能となりstorageを共有できないため、JSON経由で受け渡す
window.addEventListener("load", function(){
    const codec = window.opd_custom_settings_codec;
    const storage = window.opd_custom_storage;

    function set_status(message, is_error){
        const status_area = document.getElementById("import_status");
        status_area.textContent = message;
        status_area.style.color = is_error ? "red" : "green";
    }

    function save_import_data(import_data){
        storage.get_raw(storage.KEYS.SETTINGS, function(read_error, value){
            if(read_error != null){
                set_status("現在の設定を読み出せません: " + read_error.message, true);
                return;
            }
            try{
                const storage_items = codec.build_storage_items(
                    import_data,
                    value[storage.KEYS.SETTINGS],
                    chrome.runtime.getManifest().version
                );
                //3キーを一度に更新し、途中失敗で設定が半分だけ変わらないようにする
                storage.set_raw_items(storage_items, function(write_error){
                    if(write_error != null){
                        set_status("インポートできません: " + write_error.message, true);
                        return;
                    }
                    set_status("インポートが完了しました。Open-Deckの画面を再読み込みしてください。", false);
                });
            }catch(error){
                set_status("インポートできません: " + error.message, true);
            }
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
        reader.addEventListener("error", function(){
            document.getElementById("import_input_area").value = "";
            const detail = reader.error?.message ? ": " + reader.error.message : "";
            set_status("ファイルを読み込めませんでした" + detail, true);
        });
        reader.readAsText(file);
    });

    document.getElementById("import_btn").addEventListener("click", function(){
        const input_text = document.getElementById("import_input_area").value.trim();
        if(input_text.length == 0){
            set_status("JSONが入力されていません。", true);
            return;
        }
        let import_data = null;
        try{
            import_data = codec.decode(JSON.parse(input_text));
        }catch(error){
            set_status("Open-Deckの設定として解釈できません: " + error.message, true);
            return;
        }
        const profile_names = import_data.profile_store.map(function(profile){ return profile.name; }).join(", ");
        if(!confirm("現在のカラム構成を次のプロファイルで上書きします。よろしいですか。\n\n" + profile_names)){
            return;
        }
        save_import_data(import_data);
    });

    document.getElementById("export_btn").addEventListener("click", function(){
        const export_keys = [storage.KEYS.SETTINGS, storage.KEYS.PROFILE_STORE, storage.KEYS.COLUMN_STATE];
        storage.get_raw(export_keys, function(error, value){
            if(error != null){
                set_status("保存済み設定を読み出せません: " + error.message, true);
                return;
            }
            if(value[storage.KEYS.PROFILE_STORE] == null){
                document.getElementById("export_output_area").value = "";
                set_status("書き出せる設定がありません。先にOpen-Deckを一度開いてください。", true);
                return;
            }
            try{
                const export_data = codec.create_export(value);
                document.getElementById("export_output_area").value = JSON.stringify(export_data);
                set_status("書き出しました。テキストエリアの内容を保存してください。", false);
            }catch(error){
                document.getElementById("export_output_area").value = "";
                set_status("保存済み設定を書き出せません: " + error.message, true);
            }
        });
    });
});
