(function(){
    const region = document.getElementById("opd_fixture_reload_region");
    const counter = document.getElementById("opd_fixture_reload_count");
    const refresh = function(){
        const count = Number(counter.dataset.count) + 1;
        counter.dataset.count = String(count);
        counter.textContent = String(count);
    };

    region.__reactProps$fixture = {
        children: [
            null,
            {
                props: {
                    children: [
                        null,
                        null,
                        { _owner: { memoizedProps: { onRefresh: refresh } } },
                    ],
                },
            },
        ],
    };

    window.addEventListener("opd_column_reload_init", function(){
        document.documentElement.dataset.opdAutoReloadReady = "true";
    }, true);
    window.parent.addEventListener("opd_post_focus", function(event){
        document.documentElement.dataset.opdPostFocus = String(JSON.parse(event.detail));
    });
})();
