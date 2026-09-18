export const GOLDEN_SETTINGS = {
    last_load_profile: 0,
    version: "1.1.3.7",
};

export function column(type, overrides = {}) {
    const base = {
        type,
        banner: false,
        top_visible: true,
        tw_view_mode: "0",
        column_save_path: "",
        column_save_title: "",
        column_pinned_path: "",
        auto_reload: false,
        auto_reload_time: 10_000,
        column_width: null,
    };
    return { ...base, ...overrides };
}

export const GOLDEN_COLUMNS = [
    column("main_bar_empty_column"),
    column("home", { banner: true, tw_view_mode: "1", auto_reload: true, auto_reload_time: 15_000, column_width: "32" }),
    column("explore", { column_save_path: "/i/lists/42", column_save_title: "List 42", column_width: "34" }),
    column("empty_column"),
];

//タイムラインカラムは型で見分けられないため、タブ保存は位置を鍵にしている。
//並び替え後の再割り当てを見るには同じ型のカラムが2本要る
export const TWO_TIMELINE_COLUMNS = [
    column("main_bar_empty_column"),
    column("home", { column_width: "30" }),
    column("home", { column_width: "31" }),
    column("empty_column"),
];

export const NOTIFICATION_PROFILE_COLUMNS = [
    column("main_bar_empty_column"),
    column("notification", { column_width: "28" }),
    column("empty_column"),
];

export function storageItems(profiles, settings = {}) {
    return {
        opd_settings: JSON.stringify({ ...GOLDEN_SETTINGS, ...settings }),
        opd_profile_store: JSON.stringify(profiles.map((profile, index) => ({
            name: `e2e-${index}`,
            profile,
        }))),
    };
}

export function goldenStorageItems() {
    return storageItems([GOLDEN_COLUMNS]);
}
