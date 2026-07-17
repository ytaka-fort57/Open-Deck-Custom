//カラムごとの選択タブを保存する
//本家の保存項目(opd_profile_store)には手を入れず、独自キーへ分離して持つ
window.opd_custom_column_state = (function(){
    const STATE_KEY = "opd_custom_column_state";

    //拡張機能の更新後、ページに残った古いスクリプトはstorageを触れない。
    //その状態で操作を続けても Extension context invalidated になるだけなので、静かに諦める。
    //生存確認と呼び出しの間に無効化される場合もあるため、呼び出し自体もtryで囲む。
    function is_extension_alive(){
        try{
            return chrome.runtime != undefined && chrome.runtime.id != undefined;
        }catch(error){
            return false;
        }
    }

    function safe_get(keys, callback){
        if(!is_extension_alive()){
            return;
        }
        try{
            chrome.storage.local.get(keys, callback);
        }catch(error){
            return;
        }
    }

    function safe_set(items, callback){
        if(!is_extension_alive()){
            return;
        }
        try{
            chrome.storage.local.set(items, callback);
        }catch(error){
            return;
        }
    }

    //現在のプロファイル番号を返す
    //
    //storageから読んではいけない。本家のプロファイル切り替えは、新しい番号の保存(非同期)を
    //待たずにカラムを作り直すため(content.js:977)、カラム生成を検知して読むと切り替え前の
    //番号を掴む。復元を間違えるだけでなく、切り替え前のプロファイルの保存を壊す。
    //
    //サイドバーの表示はカラムと同時に作られるため、こちらを読めば必ず一致する。
    function get_profile_index(callback){
        const profile_label = document.querySelector(".profile_val_now");
        if(profile_label != null){
            const index = parseInt(profile_label.textContent, 10);
            if(!isNaN(index)){
                callback(index);
                return;
            }
        }
        //サイドバーが見つからない場合の保険
        safe_get("opd_settings", function(value){
            if(value.opd_settings == null){
                callback(0);
                return;
            }
            try{
                const settings = JSON.parse(value.opd_settings);
                callback(settings.last_load_profile != undefined ? settings.last_load_profile : 0);
            }catch(error){
                callback(0);
            }
        });
    }

    function load_state(callback){
        safe_get(STATE_KEY, function(value){
            if(value[STATE_KEY] == null){
                callback({});
                return;
            }
            try{
                callback(JSON.parse(value[STATE_KEY]));
            }catch(error){
                callback({});
            }
        });
    }

    function state_key(profile_index, column_index){
        return profile_index + ":" + column_index;
    }

    function get_tab(profile_index, column_index, callback){
        load_state(function(state){
            callback(state[state_key(profile_index, column_index)]);
        });
    }

    function save_tab(profile_index, column_index, label, callback){
        load_state(function(state){
            state[state_key(profile_index, column_index)] = label;
            const store = {};
            store[STATE_KEY] = JSON.stringify(state);
            safe_set(store, function(){
                if(callback != undefined){
                    callback();
                }
            });
        });
    }

    //並び替えでカラムとタブの対応を付け替えるために、保存全体を読み書きする
    function load_all(callback){
        load_state(callback);
    }

    function save_all(state, callback){
        const store = {};
        store[STATE_KEY] = JSON.stringify(state);
        safe_set(store, function(){
            if(callback != undefined){
                callback();
            }
        });
    }

    return {
        get_profile_index: get_profile_index,
        get_tab: get_tab,
        save_tab: save_tab,
        load_all: load_all,
        save_all: save_all
    };
})();
