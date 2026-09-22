//カラムごとのタブ保存の鍵を、表示位置(profile_index:column_index)から
//カラム固有の安定ID(profile_index:column_uid)へ移す。
//
//安定IDの発行もここに置く。IDはこの移行のためだけに存在し、カラム設定の
//opd_custom_uid として本家の opd_profile_store に相乗りする。
//
//DOMもstorageも見ない純粋な変換に保つ。デッキ起動時の移行(column_state)と
//設定import(settings_codec)の両方が同じ変換を通るようにするため。
window.opd_custom_column_state_migration = (function(){
    const SCHEMA_VERSION = 2;
    //カラム設定に足す安定IDの項目名。本家の column_ 系と衝突しないよう接頭辞を付ける
    const UID_FIELD = "opd_custom_uid";
    //同じ名前でカラムのルート要素の属性へも出し、DOMから読み戻す
    const UID_ATTRIBUTE = "opd_custom_uid";
    //タブ保存を持つのはタイムラインカラムだけで、旧鍵の添字もこの型だけを数えていた
    const TAB_COLUMN_TYPE = "home";
    //発行したIDが既存と衝突したときの再試行回数。生成器が壊れていても止まらないようにする
    const ISSUE_ATTEMPTS = 20;

    function is_plain_object(value){
        return value != null && typeof value === "object" && !Array.isArray(value);
    }

    function uid_of(column){
        const value = column?.[UID_FIELD];
        return typeof value === "string" ? value : "";
    }

    //移行済みの保存は {schema_version, tabs} で包む。旧形式は鍵と値だけの平坦なマップ。
    //鍵の形だけで見分けると、IDが数字だけになったときに誤判定するため版番号で見る
    function is_migrated(state){
        return is_plain_object(state) && state.schema_version === SCHEMA_VERSION;
    }

    function read_tabs(state){
        if(is_migrated(state)){
            return is_plain_object(state.tabs) ? state.tabs : {};
        }
        return is_plain_object(state) ? state : {};
    }

    function wrap_tabs(tabs){
        return {schema_version: SCHEMA_VERSION, tabs: Object.assign({}, tabs)};
    }

    //usedに無いIDを1つ返し、usedへ加える。create_id は safe_values.create_random_id を想定する
    function issue_uid(used, create_id){
        for(let attempt = 0; attempt < ISSUE_ATTEMPTS; attempt += 1){
            const candidate = typeof create_id === "function" ? create_id() : null;
            if(typeof candidate === "string" && candidate !== "" && !used.has(candidate)){
                used.add(candidate);
                return candidate;
            }
        }
        //生成器が同じ値を返し続けても重複させない
        let index = 0;
        while(used.has("uid" + index)){
            index += 1;
        }
        used.add("uid" + index);
        return "uid" + index;
    }

    //IDの無いカラムと、先に出たカラムとIDが重複したカラムへIDを配る。
    //既存のIDは保つ。返り値は新しい配列で、入力は書き換えない
    function assign_uids(profile, create_id){
        const used = new Set();
        return Array.from(profile ?? []).map(function(column){
            const uid = uid_of(column);
            if(uid !== "" && !used.has(uid)){
                used.add(uid);
                return column;
            }
            const next = {};
            next[UID_FIELD] = issue_uid(used, create_id);
            return Object.assign({}, column, next);
        });
    }

    //複製したプロファイルのIDをすべて振り直す。複製元と同じIDのままだと、
    //どちらのプロファイルのカラムを指すIDなのかが設定だけからは読めなくなる。
    //返り値の uid_map は 複製元のID -> 新しいID で、タブ保存の鍵の付け替えに使う
    function reissue_uids(profile, create_id){
        const used = new Set();
        const uid_map = {};
        const next_profile = Array.from(profile ?? []).map(function(column){
            const source_uid = uid_of(column);
            const next_uid = issue_uid(used, create_id);
            if(source_uid !== ""){
                uid_map[source_uid] = next_uid;
            }
            const next = {};
            next[UID_FIELD] = next_uid;
            return Object.assign({}, column, next);
        });
        return {profile: next_profile, uid_map: uid_map};
    }

    //旧鍵の添字が指していたカラムのID。添字はタイムラインカラムだけの連番である
    function timeline_uids(profile){
        return Array.from(profile ?? [])
            .filter(function(column){
                return column?.type === TAB_COLUMN_TYPE;
            })
            .map(uid_of);
    }

    function split_position_key(key){
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

    function is_profile_store(value){
        return Array.isArray(value) && value.length > 0 && value.every(function(profile){
            return is_plain_object(profile) && Array.isArray(profile.profile);
        });
    }

    //旧形式のタブ保存を安定ID鍵へ読み替える。profile_store にはIDを配った配列を返す。
    //
    //profile_store が読めない場合は何も変換しない。IDを配れない以上、
    //読み替えた鍵がどのカラムも指さなくなるため、旧形式のまま残すほうが安全である。
    function migrate(profile_store, column_state, create_id){
        if(is_migrated(column_state)){
            return {migrated: true, changed: false, profile_store: profile_store, column_state: column_state};
        }
        if(!is_profile_store(profile_store)){
            return {migrated: false, changed: false, profile_store: profile_store, column_state: column_state};
        }
        const next_profile_store = profile_store.map(function(profile){
            return Object.assign({}, profile, {profile: assign_uids(profile.profile, create_id)});
        });
        const uids_by_profile = next_profile_store.map(function(profile){
            return timeline_uids(profile.profile);
        });
        const tabs = read_tabs(column_state);
        const next_tabs = {};
        Object.keys(tabs).forEach(function(key){
            const parts = split_position_key(key);
            if(parts == null){
                return;
            }
            //削除済みカラム・削除済みプロファイルの残骸は捨てる
            const uid = uids_by_profile[parts.profile_index]?.[parts.column_index];
            if(uid == undefined || uid === ""){
                return;
            }
            next_tabs[parts.profile_index + ":" + uid] = tabs[key];
        });
        return {
            migrated: true,
            changed: true,
            profile_store: next_profile_store,
            column_state: wrap_tabs(next_tabs),
        };
    }

    return {
        SCHEMA_VERSION: SCHEMA_VERSION,
        UID_FIELD: UID_FIELD,
        UID_ATTRIBUTE: UID_ATTRIBUTE,
        assign_uids: assign_uids,
        is_migrated: is_migrated,
        issue_uid: issue_uid,
        migrate: migrate,
        read_tabs: read_tabs,
        reissue_uids: reissue_uids,
        timeline_uids: timeline_uids,
        wrap_tabs: wrap_tabs,
    };
})();
