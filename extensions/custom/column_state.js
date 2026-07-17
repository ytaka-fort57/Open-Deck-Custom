//カラムごとの選択タブを保存する
//本家の保存項目(opd_profile_store)には手を入れず、独自キーへ分離して持つ
window.opd_custom_column_state = (function(){
    const STATE_KEY = "opd_custom_column_state";
    const mutation_queue = [];
    let is_mutating = false;

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
            return false;
        }
        try{
            chrome.storage.local.get(keys, callback);
            return true;
        }catch(error){
            return false;
        }
    }

    function safe_set(items, callback){
        if(!is_extension_alive()){
            return false;
        }
        try{
            chrome.storage.local.set(items, callback);
            return true;
        }catch(error){
            return false;
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

    //read-modify-writeを1本ずつ処理し、短時間に複数の保存が走っても後の書き込みで消さない
    function run_next_mutation(){
        if(is_mutating || mutation_queue.length === 0){
            return;
        }
        is_mutating = true;
        const operation = mutation_queue.shift();
        const finish = function(){
            is_mutating = false;
            if(operation.callback != undefined){
                operation.callback();
            }
            run_next_mutation();
        };
        const started = safe_get(STATE_KEY, function(value){
            let state = {};
            if(value[STATE_KEY] != null){
                try{
                    state = JSON.parse(value[STATE_KEY]);
                }catch(error){
                    state = {};
                }
            }
            const next_state = operation.mutator(state);
            const store = {};
            store[STATE_KEY] = JSON.stringify(next_state == null ? state : next_state);
            if(!safe_set(store, finish)){
                finish();
            }
        });
        if(!started){
            finish();
        }
    }

    function update_all(mutator, callback){
        mutation_queue.push({mutator: mutator, callback: callback});
        run_next_mutation();
    }

    function save_tab(profile_index, column_index, label, callback){
        update_all(function(state){
            state[state_key(profile_index, column_index)] = label;
            return state;
        }, callback);
    }

    //並び替えでカラムとタブの対応を付け替えるために、保存全体を読み書きする
    function load_all(callback){
        load_state(callback);
    }

    function save_all(state, callback){
        update_all(function(){
            return Object.assign({}, state);
        }, callback);
    }

    function split_state_key(key){
        const separator = key.indexOf(":");
        if(separator < 0){
            return null;
        }
        const profile_index = Number(key.slice(0, separator));
        const column_index = Number(key.slice(separator + 1));
        if(!Number.isSafeInteger(profile_index) || profile_index < 0
            || !Number.isSafeInteger(column_index) || column_index < 0){
            return null;
        }
        return {profile_index: profile_index, column_index: column_index};
    }

    //新しいプロファイルは現在のカラム構成を複製して作られるため、タブ選択も複製する
    function copy_profile(source_profile_index, target_profile_index, callback){
        update_all(function(state){
            const next_state = {};
            Object.keys(state).forEach(function(key){
                const parts = split_state_key(key);
                //対象番号に以前の状態が残っていれば先に捨てる
                if(parts != null && parts.profile_index === target_profile_index){
                    return;
                }
                next_state[key] = state[key];
            });
            Object.keys(state).forEach(function(key){
                const parts = split_state_key(key);
                if(parts != null && parts.profile_index === source_profile_index){
                    next_state[state_key(target_profile_index, parts.column_index)] = state[key];
                }
            });
            return next_state;
        }, callback);
    }

    //プロファイル削除後は、後続プロファイルの番号を1つ前へ詰める
    function delete_profile(deleted_profile_index, callback){
        update_all(function(state){
            const next_state = {};
            Object.keys(state).forEach(function(key){
                const parts = split_state_key(key);
                if(parts == null){
                    next_state[key] = state[key];
                    return;
                }
                if(parts.profile_index === deleted_profile_index){
                    return;
                }
                const next_profile_index = parts.profile_index > deleted_profile_index
                    ? parts.profile_index - 1
                    : parts.profile_index;
                next_state[state_key(next_profile_index, parts.column_index)] = state[key];
            });
            return next_state;
        }, callback);
    }

    return {
        get_profile_index: get_profile_index,
        get_tab: get_tab,
        save_tab: save_tab,
        load_all: load_all,
        save_all: save_all,
        update_all: update_all,
        copy_profile: copy_profile,
        delete_profile: delete_profile
    };
})();
