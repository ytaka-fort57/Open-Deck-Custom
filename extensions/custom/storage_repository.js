//Open-Deckのstorage境界を一本化し、JSON互換形式とread-modify-writeの順序を管理する
window.opd_custom_storage = (function(){
    const KEYS = Object.freeze({
        SETTINGS: "opd_settings",
        PROFILE_STORE: "opd_profile_store",
        COLUMN_STATE: "opd_custom_column_state",
    });
    const STORAGE_SCHEMA_VERSION = 1;
    const NO_CHANGE = Symbol("opd_custom_storage_no_change");
    const mutation_queue = [];
    let is_mutating = false;

    function extension_error(message){
        return new Error(message || "拡張機能のstorageを利用できません");
    }

    function is_extension_alive(){
        try{
            return chrome.runtime != null && chrome.runtime.id != null;
        }catch(error){
            return false;
        }
    }

    function runtime_error(){
        try{
            return chrome.runtime.lastError == null
                ? null
                : extension_error(chrome.runtime.lastError.message);
        }catch(error){
            return extension_error(error.message);
        }
    }

    function get_raw(keys, callback){
        if(!is_extension_alive()){
            callback(extension_error(), {});
            return;
        }
        try{
            chrome.storage.local.get(keys, function(value){
                const error = runtime_error();
                callback(error, error == null ? value : {});
            });
        }catch(error){
            callback(extension_error(error.message), {});
        }
    }

    function set_raw(items, callback){
        if(!is_extension_alive()){
            callback(extension_error());
            return;
        }
        try{
            chrome.storage.local.set(items, function(){
                callback(runtime_error());
            });
        }catch(error){
            callback(extension_error(error.message));
        }
    }

    function remove_raw(keys, callback){
        if(!is_extension_alive()){
            callback(extension_error());
            return;
        }
        try{
            chrome.storage.local.remove(keys, function(){
                callback(runtime_error());
            });
        }catch(error){
            callback(extension_error(error.message));
        }
    }

    function parse_json(raw_value, key, fallback){
        if(raw_value == null){
            return fallback;
        }
        if(typeof raw_value !== "string"){
            return raw_value;
        }
        try{
            return JSON.parse(raw_value);
        }catch(error){
            throw new Error(key + " のJSONが壊れています: " + error.message);
        }
    }

    function serialize_json_values(values){
        const items = {};
        Object.keys(values).forEach(function(key){
            items[key] = JSON.stringify(values[key]);
        });
        return items;
    }

    function get_json(key, fallback, callback){
        get_raw(key, function(error, value){
            if(error != null){
                callback(error, fallback);
                return;
            }
            try{
                callback(null, parse_json(value[key], key, fallback));
            }catch(parse_error){
                callback(parse_error, fallback);
            }
        });
    }

    //defaultsは {storage_key: fallback} の形で渡し、同一snapshotからまとめて復元する
    function get_json_many(defaults, callback){
        const keys = Object.keys(defaults);
        get_raw(keys, function(error, value){
            if(error != null){
                callback(error, Object.assign({}, defaults));
                return;
            }
            try{
                const result = {};
                keys.forEach(function(key){
                    result[key] = parse_json(value[key], key, defaults[key]);
                });
                callback(null, result);
            }catch(parse_error){
                callback(parse_error, Object.assign({}, defaults));
            }
        });
    }

    function run_next_mutation(){
        if(is_mutating || mutation_queue.length === 0){
            return;
        }
        is_mutating = true;
        const queued = mutation_queue.shift();
        let is_finished = false;
        const finish = function(error, value){
            if(is_finished){
                return;
            }
            is_finished = true;
            is_mutating = false;
            if(typeof queued.callback === "function"){
                queued.callback(error || null, value);
            }
            run_next_mutation();
        };
        try{
            queued.operation(finish);
        }catch(error){
            finish(error);
        }
    }

    function enqueue_mutation(operation, callback){
        mutation_queue.push({operation, callback});
        run_next_mutation();
    }

    function set_json(key, value, callback){
        const values = {};
        values[key] = value;
        set_json_many(values, callback);
    }

    function set_json_many(values, callback){
        //呼び出し時点のsnapshotを確定し、queue待ち中の参照先変更を混ぜない
        const serialized_items = serialize_json_values(values);
        enqueue_mutation(function(finish){
            set_raw(serialized_items, finish);
        }, callback);
    }

    function set_raw_items(items, callback){
        const storage_items = Object.assign({}, items);
        enqueue_mutation(function(finish){
            set_raw(storage_items, finish);
        }, callback);
    }

    function update_json(key, fallback, mutator, callback){
        enqueue_mutation(function(finish){
            get_raw(key, function(error, value){
                if(error != null){
                    finish(error);
                    return;
                }
                let current;
                let next;
                try{
                    current = parse_json(value[key], key, fallback);
                    next = mutator(current);
                    if(next === undefined){
                        throw new Error(key + " の更新関数が値を返しませんでした");
                    }
                }catch(update_error){
                    finish(update_error);
                    return;
                }
                const next_value = next === NO_CHANGE ? current : next;
                const items = {};
                items[key] = JSON.stringify(next_value);
                set_raw(items, function(set_error){
                    finish(set_error, next_value);
                });
            });
        }, callback);
    }

    function remove(keys, callback){
        enqueue_mutation(function(finish){
            remove_raw(keys, finish);
        }, callback);
    }

    return {
        KEYS,
        NO_CHANGE,
        STORAGE_SCHEMA_VERSION,
        get_json,
        get_json_many,
        get_raw,
        remove,
        set_json,
        set_json_many,
        set_raw_items,
        update_json,
    };
})();
