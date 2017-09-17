var handler = {
    get: function (target, name) {
        if (!(name in target)) {
            target[name] = {
                helpers: function (helpers) {
                    this.helpers = helpers;
                },
                getHelpers: function() {
                    return this.helpers
                }
            }
        }
        return target[name]
    }

};

Template = new Proxy({}, handler)