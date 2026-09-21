//X 本体のDOMを監視する MutationObserver をまとめて持つ。
//どの初期化も disposer(引数なしの関数)を返し、呼ぶと自分が張った observer だけを止める。
window.opd_custom_page_observer_lifecycle = (function(){
    let dispose_page_observers = null;
    let dispose_title_favicon = null;

    function noop(){
    }

    function dispose_all(observers){
        return function(){
            observers.forEach(function(observer){
                observer.disconnect();
            });
            observers.length = 0;
        };
    }

    //target が現れるまで watch_root を見張り、現れたら本来の observer へ切り替える。
    //戻り値の disposer は待機中・監視中のどちらで呼ばれても両方を止める。
    function observe_when_ready(get_target, watch_root, observer_callback, observer_options){
        const observers = [];
        const observe_target = function(target){
            observer_callback(target);
            const observer = new MutationObserver(function(){
                observer_callback(target);
            });
            observer.observe(target, observer_options);
            observers.push(observer);
        };

        const target = get_target();
        if(target){
            observe_target(target);
            return dispose_all(observers);
        }

        if(!watch_root){
            return noop;
        }

        const wait_observer = new MutationObserver(function(){
            const target_retry = get_target();
            if(target_retry){
                wait_observer.disconnect();
                observe_target(target_retry);
            }
        });
        wait_observer.observe(watch_root, {childList: true});
        observers.push(wait_observer);
        return dispose_all(observers);
    }

    //2度目以降はコールバックを1回だけ流し直し、observer は張り直さない。
    function initialize_page_observers(options){
        if(dispose_page_observers != null){
            options.on_react_change(options.get_react_root());
            const head = options.get_head();
            if(head){
                options.on_head_change(head);
            }
            return dispose_page_observers;
        }

        const disposers = [
            observe_when_ready(
                options.get_react_root,
                options.react_watch_root,
                options.on_react_change,
                options.react_observer_options
            ),
            observe_when_ready(
                options.get_head,
                options.head_watch_root,
                options.on_head_change,
                options.head_observer_options
            ),
        ];

        dispose_page_observers = function(){
            disposers.forEach(function(dispose){
                dispose();
            });
            dispose_page_observers = null;
        };
        return dispose_page_observers;
    }

    function initialize_title_favicon(title, favicon_url){
        if(dispose_title_favicon != null){
            return dispose_title_favicon;
        }
        const observers = [];

        document.head.querySelectorAll("title").forEach(function(element){
            if(element.dataset.opd !== "1"){
                element.remove();
            }
        });
        let opd_title = document.head.querySelector('title[data-opd="1"]');
        if(!opd_title){
            opd_title = document.createElement("title");
            opd_title.dataset.opd = "1";
            opd_title.textContent = title;
            document.head.appendChild(opd_title);
        }

        const title_observer = new MutationObserver(function(){
            if(opd_title.textContent !== title){
                opd_title.textContent = title;
            }
            document.head.querySelectorAll("title").forEach(function(element){
                if(element.dataset.opd !== "1"){
                    element.remove();
                }
            });
        });
        title_observer.observe(opd_title, {
            childList: true,
            characterData: true,
            subtree: true,
        });
        observers.push(title_observer);

        const head_title_observer = new MutationObserver(function(mutations){
            for(const mutation of mutations){
                for(const node of mutation.addedNodes){
                    if(node.tagName === "TITLE" && node.dataset.opd !== "1"){
                        node.remove();
                    }
                }
            }
        });
        head_title_observer.observe(document.head, {childList: true});
        observers.push(head_title_observer);

        document.head.querySelectorAll('link[rel="shortcut icon"], link[rel="icon"]').forEach(function(element){
            if(element.dataset.opd !== "1"){
                element.remove();
            }
        });
        let opd_favicon = document.head.querySelector('link[data-opd="1"]');
        if(!opd_favicon){
            opd_favicon = document.createElement("link");
            opd_favicon.rel = "shortcut icon";
            opd_favicon.href = favicon_url;
            opd_favicon.dataset.opd = "1";
            document.head.appendChild(opd_favicon);
        }

        const favicon_observer = new MutationObserver(function(){
            if(opd_favicon.getAttribute("href") !== favicon_url){
                opd_favicon.setAttribute("href", favicon_url);
            }
        });
        favicon_observer.observe(opd_favicon, {
            attributes: true,
            attributeFilter: ["href", "rel"],
        });
        observers.push(favicon_observer);

        const head_favicon_observer = new MutationObserver(function(mutations){
            for(const mutation of mutations){
                for(const node of mutation.addedNodes){
                    if(node.tagName === "LINK"
                        && (node.rel === "shortcut icon" || node.rel === "icon")
                        && node.dataset.opd !== "1"){
                        node.remove();
                    }
                }
            }
        });
        head_favicon_observer.observe(document.head, {childList: true});
        observers.push(head_favicon_observer);

        const dispose_observers = dispose_all(observers);
        dispose_title_favicon = function(){
            dispose_observers();
            dispose_title_favicon = null;
        };
        return dispose_title_favicon;
    }

    return {
        initialize_page_observers,
        initialize_title_favicon,
        observe_when_ready,
    };
})();
