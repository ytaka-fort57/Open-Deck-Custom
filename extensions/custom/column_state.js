//カラムごとの選択タブを保存する
//本家の保存項目(opd_profile_store)には手を入れず、独自キーへ分離して持つ
window.opd_custom_column_state = (function(){
    const STATE_KEY = "opd_custom_column_state";

    //拡張機能の更新後、ページに残った古いスクリプトはstorageを触れない
    //その状態で操作を続けても例外になるだけなので、静かに諦める
    function is_extension_alive(){
        try{
            return chrome.runtime != undefined && chrome.runtime.id != undefined;
        }catch(error){
            return false;
        }
    }

    //本家の内部変数へ依存しないよう、現在のプロファイル番号は設定から読む
    function get_profile_index(callback){
        if(!is_extension_alive()){
            return;
        }
        chrome.storage.local.get("opd_settings", function(value){
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
        if(!is_extension_alive()){
            return;
        }
        chrome.storage.local.get(STATE_KEY, function(value){
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
            chrome.storage.local.set(store, function(){
                if(callback != undefined){
                    callback();
                }
            });
        });
    }

    return {
        get_profile_index: get_profile_index,
        get_tab: get_tab,
        save_tab: save_tab
    };
})();
