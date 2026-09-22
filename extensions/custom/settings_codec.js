//カスタム版の設定import/exportで共有するスキーマ・検証処理
window.opd_custom_settings_codec = (function(){
    const safe_values = window.opd_custom_safe_values;
    const migration = window.opd_custom_column_state_migration;
    const FORMAT = "open-deck-custom-settings";
    //1: タブ保存の鍵が表示位置 / 2: カラム固有の安定ID
    const SCHEMA_VERSION = migration.SCHEMA_VERSION;
    const COLUMN_TYPES = new Set([
        "main_bar_empty_column",
        "empty_column",
        "second_empty_column",
        "post",
        "home",
        "notification",
        "explore"
    ]);

    function is_plain_object(value){
        return value != null && typeof value === "object" && !Array.isArray(value);
    }

    function parse_json_value(value, field_name){
        if(typeof value !== "string"){
            return value;
        }
        try{
            return JSON.parse(value);
        }catch(error){
            throw new Error(field_name + " のJSONが壊れています: " + error.message);
        }
    }

    function validate_column(column){
        if(!is_plain_object(column) || !COLUMN_TYPES.has(column.type)){
            return false;
        }
        for(const boolean_field of ["banner", "top_visible", "auto_reload"]){
            if(column[boolean_field] != null && typeof column[boolean_field] !== "boolean"){
                return false;
            }
        }
        if(column.tw_view_mode != null && !["0", "1", "2"].includes(String(column.tw_view_mode))){
            return false;
        }
        for(const string_field of ["column_save_path", "column_save_title", "column_pinned_path", migration.UID_FIELD]){
            if(column[string_field] != null && !safe_values.is_safe_text(column[string_field], 2048)){
                return false;
            }
        }
        if(column.column_save_path && !safe_values.is_safe_x_path(column.column_save_path)){
            return false;
        }
        if(column.column_pinned_path && !safe_values.is_safe_x_path(column.column_pinned_path)){
            return false;
        }
        if(column.auto_reload_time != null){
            const interval = Number(column.auto_reload_time);
            if(!Number.isFinite(interval) || interval < 1000){
                return false;
            }
        }
        if(column.column_width != null){
            const width = Number(column.column_width);
            if(!Number.isFinite(width) || width <= 0){
                return false;
            }
        }
        if(column.type === "explore"){
            if(typeof column.column_save_path !== "string" || !column.column_save_path.startsWith("/")){
                return false;
            }
        }
        return true;
    }

    function validate_profile_store(profile_store){
        if(!Array.isArray(profile_store) || profile_store.length === 0){
            return false;
        }
        return profile_store.every(function(profile){
            return is_plain_object(profile)
                && typeof profile.name === "string"
                && profile.name.length > 0
                && Array.isArray(profile.profile)
                && profile.profile.length > 0
                && profile.profile.every(validate_column);
        });
    }

    //旧形式の省略値を画面側の設定モデルへ揃える。未知の項目は将来互換のため保持する。
    function normalize_column(column){
        //既知の項目だけを写すため、安定IDを足さないとimportで全カラムのIDが消える
        return Object.assign({}, column, {
            [migration.UID_FIELD]: column[migration.UID_FIELD] == null
                ? ""
                : String(column[migration.UID_FIELD]),
            banner: column.banner === true,
            top_visible: column.top_visible === true,
            tw_view_mode: column.tw_view_mode == null ? "0" : String(column.tw_view_mode),
            column_save_path: column.column_save_path == null ? "" : String(column.column_save_path),
            column_save_title: column.column_save_title == null ? "" : String(column.column_save_title),
            column_pinned_path: column.column_pinned_path == null ? "" : String(column.column_pinned_path),
            auto_reload: column.auto_reload === true,
            auto_reload_time: column.auto_reload_time == null
                ? 10000
                : Number(column.auto_reload_time),
            column_width: column.column_width == null || column.column_width === "null"
                ? null
                : String(column.column_width),
        });
    }

    function normalize_profile_store(profile_store){
        return profile_store.map(function(profile){
            return Object.assign({}, profile, {
                profile: profile.profile.map(normalize_column),
            });
        });
    }

    function validate_settings(settings){
        if(settings == null){
            return true;
        }
        if(!is_plain_object(settings)){
            return false;
        }
        if(settings.last_load_profile != null
            && (!Number.isSafeInteger(settings.last_load_profile) || settings.last_load_profile < 0)){
            return false;
        }
        if(settings.version != null && typeof settings.version !== "string"){
            return false;
        }
        return true;
    }

    //version 1 は鍵と値だけの平坦なマップ、version 2 は {schema_version, tabs}。
    //鍵の右側は version 1 が表示位置、version 2 がカラム固有の安定ID
    function validate_tabs(tabs){
        if(!is_plain_object(tabs)){
            return false;
        }
        return Object.keys(tabs).every(function(key){
            return /^\d+:[0-9A-Za-z_-]+$/.test(key) && typeof tabs[key] === "string";
        });
    }

    function validate_column_state(column_state){
        if(!is_plain_object(column_state)){
            return false;
        }
        if(migration.is_migrated(column_state)){
            return Object.keys(column_state).every(function(key){
                return key === "schema_version" || key === "tabs";
            }) && validate_tabs(column_state.tabs);
        }
        return validate_tabs(column_state);
    }

    function normalize(input_data){
        if(Array.isArray(input_data)){
            return {profile_store: input_data, settings: null, column_state: {}};
        }
        if(!is_plain_object(input_data)){
            throw new Error("Open-Deckの設定オブジェクトではありません");
        }
        if(input_data.format != null && input_data.format !== FORMAT){
            throw new Error("未対応の設定形式です: " + input_data.format);
        }
        if(input_data.schema_version != null
            && (!Number.isSafeInteger(input_data.schema_version)
                || input_data.schema_version < 1
                || input_data.schema_version > SCHEMA_VERSION)){
            throw new Error("未対応の設定スキーマです: " + input_data.schema_version);
        }
        if(input_data.row_settings !== undefined){
            return {
                profile_store: [{name: "default", profile: input_data.row_settings}],
                settings: null,
                column_state: {}
            };
        }
        if(input_data.opd_profile_store === undefined){
            throw new Error("opd_profile_store がありません");
        }
        return {
            profile_store: parse_json_value(input_data.opd_profile_store, "opd_profile_store"),
            settings: input_data.opd_settings == null
                ? null
                : parse_json_value(input_data.opd_settings, "opd_settings"),
            column_state: input_data.opd_custom_column_state == null
                ? {}
                : parse_json_value(input_data.opd_custom_column_state, "opd_custom_column_state")
        };
    }

    function decode(input_data){
        const normalized = normalize(input_data);
        if(!validate_profile_store(normalized.profile_store)){
            throw new Error("プロファイルまたはカラム設定の形式が不正です");
        }
        if(!validate_settings(normalized.settings)){
            throw new Error("opd_settings の形式が不正です");
        }
        if(!validate_column_state(normalized.column_state)){
            throw new Error("カラムごとのタブ状態の形式が不正です");
        }
        //version 1 のファイルは読み込み時にID鍵へ移す。移行はデッキ側と同じ変換を通す
        const migrated = migration.migrate(
            normalize_profile_store(normalized.profile_store),
            normalized.column_state,
            safe_values.create_random_id
        );
        return Object.assign({}, normalized, {
            profile_store: migrated.profile_store,
            column_state: migration.is_migrated(migrated.column_state)
                ? migrated.column_state
                : migration.wrap_tabs(migration.read_tabs(migrated.column_state)),
        });
    }

    function current_settings_or_default(stored_settings, manifest_version){
        if(stored_settings == null){
            return {last_load_profile: 0, version: manifest_version};
        }
        const parsed = parse_json_value(stored_settings, "現在のopd_settings");
        if(!validate_settings(parsed)){
            throw new Error("現在のopd_settingsの形式が不正です");
        }
        return parsed;
    }

    function build_storage_items(import_data, stored_settings, manifest_version){
        const settings_source = import_data.settings == null
            ? current_settings_or_default(stored_settings, manifest_version)
            : import_data.settings;
        const settings = {
            last_load_profile: 0,
            version: settings_source.version || manifest_version
        };
        return {
            opd_profile_store: JSON.stringify(import_data.profile_store),
            opd_settings: JSON.stringify(settings),
            opd_custom_column_state: JSON.stringify(import_data.column_state)
        };
    }

    function create_export(storage_value){
        const data = decode({
            opd_profile_store: storage_value.opd_profile_store,
            opd_settings: storage_value.opd_settings == null ? null : storage_value.opd_settings,
            opd_custom_column_state: storage_value.opd_custom_column_state == null
                ? {}
                : storage_value.opd_custom_column_state
        });
        return {
            format: FORMAT,
            schema_version: SCHEMA_VERSION,
            opd_settings: data.settings,
            opd_profile_store: data.profile_store,
            opd_custom_column_state: data.column_state
        };
    }

    return {
        FORMAT: FORMAT,
        SCHEMA_VERSION: SCHEMA_VERSION,
        decode: decode,
        build_storage_items: build_storage_items,
        create_export: create_export,
        validate_profile_store: validate_profile_store,
        validate_column_state: validate_column_state
    };
})();
