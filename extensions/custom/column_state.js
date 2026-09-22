//カラムごとの選択タブを保存する
//本家の保存項目(opd_profile_store)には手を入れず、独自キーへ分離して持つ
window.opd_custom_column_state = (function(){
    const storage = window.opd_custom_storage;
    const migration = window.opd_custom_column_state_migration;
    const STATE_KEY = storage.KEYS.COLUMN_STATE;
    const PROFILE_STORE_KEY = storage.KEYS.PROFILE_STORE;
    //移行前の保存をそのまま残す。古い版へ戻すときに手で書き戻すための控え
    const LEGACY_STATE_KEY = STATE_KEY + "_v1";

    //鍵の右側が安定IDか表示位置か。移行を1度通すまで決まらない
    let key_mode = null;
    let ready_callbacks = [];
    let readiness_started = false;

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
        storage.get_json(storage.KEYS.SETTINGS, null, function(error, settings){
            if(error != null || settings == null){
                callback(0);
                return;
            }
            callback(settings.last_load_profile != undefined ? settings.last_load_profile : 0);
        });
    }

    function load_state(callback){
        storage.get_json(STATE_KEY, {}, function(error, state){
            callback(error == null ? state : {});
        });
    }

    function state_key(profile_index, column_key){
        return profile_index + ":" + column_key;
    }

    function get_tab(profile_index, column_key, callback){
        load_state(function(state){
            callback(migration.read_tabs(state)[state_key(profile_index, column_key)]);
        });
    }

    //mutatorは鍵と値だけのマップを受け取る。移行済みかどうかの包みはここで着せ替える
    function update_all(mutator, callback){
        storage.update_json(STATE_KEY, {}, function(state){
            const next_tabs = mutator(migration.read_tabs(state));
            return migration.is_migrated(state) ? migration.wrap_tabs(next_tabs) : next_tabs;
        }, function(){
            if(callback != undefined){
                callback();
            }
        });
    }

    function save_tab(profile_index, column_key, label, callback){
        update_all(function(state){
            state[state_key(profile_index, column_key)] = label;
            return state;
        }, callback);
    }

    //並び替えでカラムとタブの対応を付け替えるために、保存全体を読み書きする
    //(移行後は付け替え自体が不要になるため、位置キーで起動したときだけ使われる)
    function load_all(callback){
        load_state(function(state){
            callback(migration.read_tabs(state));
        });
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
        const column_key = key.slice(separator + 1);
        if(!Number.isSafeInteger(profile_index) || profile_index < 0 || column_key === ""){
            return null;
        }
        if(!is_stable_id_mode()){
            const column_index = Number(column_key);
            if(!Number.isSafeInteger(column_index) || column_index < 0){
                return null;
            }
            return {profile_index: profile_index, column_key: column_index};
        }
        return {profile_index: profile_index, column_key: column_key};
    }

    //新しいプロファイルは現在のカラム構成を複製して作られるため、タブ選択も複製する。
    //複製したカラムのIDは振り直されるので、uid_map(複製元のID -> 新しいID)で鍵を読み替える
    function copy_profile(source_profile_index, target_profile_index, uid_map, callback){
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
                if(parts == null || parts.profile_index !== source_profile_index){
                    return;
                }
                const target_key = is_stable_id_mode()
                    ? uid_map?.[parts.column_key]
                    : parts.column_key;
                if(target_key == undefined){
                    return;
                }
                next_state[state_key(target_profile_index, target_key)] = state[key];
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
                next_state[state_key(next_profile_index, parts.column_key)] = state[key];
            });
            return next_state;
        }, callback);
    }

    function is_stable_id_mode(){
        return key_mode === "uid";
    }

    function settle(mode){
        key_mode = mode;
        const pending = ready_callbacks;
        ready_callbacks = [];
        pending.forEach(function(callback){
            callback();
        });
    }

    //鍵の形が決まるまで待つ。決まる前にカラムを触ると、移行後の起動で位置キーを書いてしまう
    function when_ready(callback){
        if(key_mode != null){
            callback();
            return;
        }
        ready_callbacks.push(callback);
        if(readiness_started){
            return;
        }
        readiness_started = true;
        //移行(ensure_migrated)を通らない画面でも止まらないよう、保存の形だけ見て決める
        load_state(function(state){
            if(key_mode == null){
                settle(migration.is_migrated(state) ? "uid" : "position");
            }
        });
    }

    //このカラムのタブ保存の鍵。移行後は安定ID、移行前は表示位置
    function column_key(column_element, position_index){
        if(!is_stable_id_mode()){
            return position_index;
        }
        const uid = column_element?.getAttribute?.(migration.UID_ATTRIBUTE);
        return uid == undefined || uid === "" ? null : uid;
    }

    //タブ保存を位置キーから安定IDへ移す。カラムを描画する前に1度だけ呼ぶ。
    //描画後に呼ぶと、移行前の鍵で復元が始まり移行後の保存と競合する。
    //
    //変換できなかった場合は何も書かず、位置キーのまま起動する。callbackには
    //IDを配ったあとの profile_store を渡す。変換しなかった場合は null を渡す。
    function ensure_migrated(create_id, callback){
        readiness_started = true;
        const defaults = {};
        defaults[PROFILE_STORE_KEY] = null;
        defaults[STATE_KEY] = {};
        let result = null;
        storage.update_json_many(defaults, function(current){
            result = migration.migrate(current[PROFILE_STORE_KEY], current[STATE_KEY], create_id);
            if(!result.changed){
                return storage.NO_CHANGE;
            }
            const next = {};
            next[PROFILE_STORE_KEY] = result.profile_store;
            next[STATE_KEY] = result.column_state;
            //版を戻すときのために移行前の保存を残す。移行は1度きりなので上書きされない
            next[LEGACY_STATE_KEY] = migration.read_tabs(current[STATE_KEY]);
            return next;
        }, function(error){
            if(error != null){
                console.error("Open-Deck column tab state could not be migrated.", error);
                settle("position");
                callback(null);
                return;
            }
            settle(result != null && result.migrated ? "uid" : "position");
            callback(result != null && result.changed ? result.profile_store : null);
        });
    }

    return {
        get_profile_index: get_profile_index,
        get_tab: get_tab,
        save_tab: save_tab,
        load_all: load_all,
        save_all: save_all,
        update_all: update_all,
        copy_profile: copy_profile,
        delete_profile: delete_profile,
        column_key: column_key,
        ensure_migrated: ensure_migrated,
        is_stable_id_mode: is_stable_id_mode,
        when_ready: when_ready,
        LEGACY_STATE_KEY: LEGACY_STATE_KEY,
    };
})();
